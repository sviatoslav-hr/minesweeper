import { isInsideRect, v2Clone, type Rect, type Vec2 } from '$math';
import { KeyboardInput } from './input';
import { Random } from './random';
import { Renderer2d, type FontRendered } from './renderer';
import { SoundManager } from './sound';
import './style.css';

/*
TODO:
- Add pause button (and key) that hides the minefield until unpaused.
- Add a mute button (and key).
- Add a scoreboard.
- Add multiple presets with different minefield sizes and difficulty levels.
- Allow optionally specifying the seed for minefield generation in the URL.
- Add a second "theme" where number color is displayed as text instead of a background.
- If screen is vertical, rotate the board.
- PERF: Change array to be index based instead of 2d array.
- TODO: Rename Flag to Mark and functions to markFlagged, etc
- Add a cool win animation.
- Add a cool lose animation (some kind of explosion?).
*/

const Color = {
	BACKGROUND: '--color-bg',
	CELL: '--color-cell',
	CELL_HOVER: '--color-cell-hover',
	CELL_EMPTY: '--color-cell-empty',
	CELL_WRONG: '--color-cell-wrong',
	CELL_EXPLODED: '--color-cell-exploded',
	CELL_TEXT: '--color-cell-text',
	TEXT_TOPBAR: '--color-text-topbar',
	NUMBER1: '--color-number-1',
	NUMBER2: '--color-number-2',
	NUMBER3: '--color-number-3',
	NUMBER4: '--color-number-4',
	NUMBER5: '--color-number-5',
	NUMBER6: '--color-number-6',
	NUMBER7: '--color-number-7',
	NUMBER8: '--color-number-8',
};
const ColorVar = {
	...Color,
} as const;

declare global {
	var minesweeper: Minesweeper | undefined;
}

type Minesweeper = {
	field: Minefield;
	originalFlags: number[][];
	playerFlags: number[][];
	solverFlags: number[][];
	expectedMinesCount: number;
	generated: boolean;
	solved: boolean;
	done: boolean;
	failed: boolean;
	time: number;
};

type Minefield = {
	rows: number;
	cols: number;
	data: number[][]; // -1 = mine, 0 = empty, 1-8 = number of mines around
	minesCount: number;
	flags: number[][]; // 0 = unknown, 1 = flagged, 2 = revealed
};

const PADDING_CANVAS = 0.01;
const PADDING_CELL = 0.07;
const TOPBAR_HEIGHT = 0.07;
const TOPBAR_RADIUS = 4;
const CELL_RADIUS = 4;
const DEFAULT_MINE_DENSITY = 0.21;
const DEFAULT_ROWS = 16;
const DEFAULT_COLS = 30;
const DEV = new URL(location.href).hostname === 'localhost';

async function main(): Promise<void> {
	console.log('[INFO]: Game version 0.1');
	initColors();
	const appElement = document.getElementById('app');
	const storage: Storage = localStorage;

	if (!appElement) {
		console.error('[ERROR]: App element not found');
		return;
	}

	const canvas = document.createElement('canvas');
	// Disable context menu from appearing on right-click
	canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
	appElement.appendChild(canvas);
	const sounds = new SoundManager();
	canvas.addEventListener('pointerdown', sounds.unlock);
	const context = canvas.getContext('2d');
	if (!context) {
		console.error('[ERROR]: Canvas context not supported');
		return;
	}

	const savedMinesweeper = storage.getItem('minesweeper');
	if (savedMinesweeper) {
		try {
			const saved = JSON.parse(savedMinesweeper) as Minesweeper;
			saved.playerFlags = saved.field.flags;
			globalThis.minesweeper = saved;
		} catch (e) {
			console.error('[ERROR]: Failed to parse saved minesweeper', e);
		}
	}

	const images = await loadImages();

	const r = new Renderer2d(context);
	r.resizeCanvas(window.innerWidth, window.innerHeight);

	window.addEventListener('resize', () => {
		r.resizeCanvas(window.innerWidth, window.innerHeight);
	});
	window.addEventListener('beforeunload', () => {
		if (minesweeper) {
			minesweeper.field.flags = minesweeper.playerFlags;
			storage.setItem('minesweeper', JSON.stringify(minesweeper));
		}
	});

	const input = new KeyboardInput();
	input.listen(document.body, document.body);

	const rows = DEFAULT_ROWS;
	const cols = DEFAULT_COLS;

	let lastTime = performance.now();
	const tick = (time: number) => {
		const deltaTime = time - lastTime;
		lastTime = time;

		if (!globalThis.minesweeper || input.isPressed('KeyR')) {
			globalThis.minesweeper = createMinesweeper(rows, cols);
		}
		let minesweeper = globalThis.minesweeper;

		r.fillScreen(Color.BACKGROUND);

		let config = computeConfig(canvas, minesweeper, images);
		const smileyHovered = isInsideRect(input.getMousePosition(), getSmileyRect(config));
		if (smileyHovered && input.isPressed('MouseLeft')) {
			void sounds.play('click');
			minesweeper = createMinesweeper(rows, cols);
			globalThis.minesweeper = minesweeper;
			config = computeConfig(canvas, minesweeper, images);
		}
		config.debugReveal = DEV && input.isDown('Space');

		if (minesweeper?.generated && !minesweeper.done) {
			minesweeper.time += deltaTime;
		}

		let isAnyHovered = smileyHovered;
		if (minesweeper.done && input.isPressed('KeyP')) {
			globalThis.minesweeper = {
				...minesweeper,
				done: false,
				failed: false,
				time: 0,
				playerFlags: minesweeper.originalFlags.map((r) => r.slice()),
			};
		}

		drawTopbar(r, minesweeper, config, images);

		r.setFont(config.cellFont);
		r.context.textBaseline = config.textBaseline;
		r.context.textAlign = config.textAlign;

		for (let row = 0; row < minesweeper.field.rows; row++) {
			for (let col = 0; col < minesweeper.field.cols; col++) {
				try {
					const cell = computeCell(config, minesweeper.field, row, col);
					if (!minesweeper.done) {
						handleCellInput(minesweeper, input, cell, sounds);
					}
					drawCell(r, config, minesweeper, cell);
					isAnyHovered ||= cell.hovered;
				} catch (e) {
					console.error(`[ERROR]: Failed to compute cell [${row};${col}]`, e);
				}
			}
		}

		// PERF: Check if its fine to be constantly updating the style.
		if (isAnyHovered) {
			document.body.style.cursor = 'pointer';
		} else {
			document.body.style.cursor = 'default';
		}

		input.nextTick();
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

function createMinesweeper(rows: number, cols: number): Minesweeper {
	console.debug('INFO: Initializing minesweeper');
	const field = emptyMinefield(rows, cols);
	const expectedMinesCount = Math.round(field.rows * field.cols * DEFAULT_MINE_DENSITY);
	return {
		field,
		playerFlags: field.flags,
		originalFlags: field.flags.map((row) => row.slice()),
		solverFlags: field.flags.map((row) => row.slice()),
		expectedMinesCount,
		generated: false,
		done: false,
		failed: false,
		solved: false,
		time: 0,
	};
}

type GameConfig = {
	cellSize: number;
	cellPadding: number;
	cellFont: FontRendered;
	gridWidth: number;
	gridHeight: number;
	gridXOffset: number;
	gridYOffset: number;
	topbarYOffset: number;
	topbarHeight: number;
	topbarIconY: number;
	topbarIconSize: number;
	topbarFont: FontRendered;
	textBaseline: CanvasTextBaseline;
	textAlign: CanvasTextAlign;
	debugReveal: boolean;
	images: GameImages;
};

function computeConfig(canvas: HTMLCanvasElement, minesweeper: Minesweeper, images: GameImages): GameConfig {
	const { rows, cols } = minesweeper.field;
	const shortestCanvasSide = Math.min(canvas.width, canvas.height);
	const outerPadding = shortestCanvasSide * PADDING_CANVAS;

	const topbarHeight = shortestCanvasSide * TOPBAR_HEIGHT;
	const topbarYOffset = outerPadding;
	const topbarFont: FontRendered = { size: topbarHeight * 0.8, weight: 700, family: 'Arial' };
	const topbarIconSize = topbarHeight * 0.8;
	const topbarIconY = topbarYOffset + topbarHeight / 2 - topbarIconSize / 2;

	const gridSpaceWidth = canvas.width - outerPadding * 2;
	const gridSpaceHeight = canvas.height - topbarHeight - outerPadding * 3; // 1 pad top, 1 bottom, 1 between topbar and grid

	const cellPadding = Math.min(gridSpaceWidth / cols, gridSpaceHeight / rows) * PADDING_CELL;
	const cellMaxWidth = (gridSpaceWidth - (cols - 1) * cellPadding) / cols;
	const cellMaxHeight = (gridSpaceHeight - (rows - 1) * cellPadding) / rows;
	const cellSize = Math.min(cellMaxWidth, cellMaxHeight);
	const cellFont: FontRendered = { size: cellSize * 0.8, weight: 700, family: 'Arial' };

	const gridWidth = cols * cellSize + (cols - 1) * cellPadding;
	const gridHeight = rows * cellSize + (rows - 1) * cellPadding;
	const gridXOffset = (canvas.width - gridWidth) / 2;
	const gridYOffset = topbarYOffset + topbarHeight + outerPadding;

	return {
		cellSize,
		cellPadding,
		cellFont,
		gridWidth,
		gridHeight,
		gridXOffset,
		gridYOffset,
		topbarYOffset,
		topbarHeight,
		topbarIconY,
		topbarIconSize,
		topbarFont,
		images,
		textBaseline: 'middle',
		textAlign: 'center',
		debugReveal: false,
	};
}

type CellInfo = {
	row: number;
	col: number;
	x: number;
	y: number;
	rect: Rect;
	center: Vec2;
	hovered: boolean;
	revealed: boolean;
	flagged: boolean;
	hinted: boolean;
	value: number;
};

function computeCell(config: GameConfig, minefield: Minefield, row: number, col: number): CellInfo {
	const x = config.gridXOffset + col * config.cellSize + col * config.cellPadding;
	const y = config.gridYOffset + row * config.cellSize + row * config.cellPadding;
	const rect: Rect = {
		x,
		y,
		width: config.cellSize,
		height: config.cellSize,
	};
	const center = {
		x: x + config.cellSize / 2,
		y: y + config.cellSize / 2,
	};
	const flagged = minefield.flags[row][col] === Flag.FLAGGED;
	const revealed = minefield.flags[row][col] === Flag.REVEALED;
	const value = minefield.data[row][col];
	const cell: CellInfo = {
		x,
		y,
		row,
		col,
		value,
		rect,
		center,
		hovered: false, // is computed in the handler
		hinted: false, // is computed in the handler
		flagged: flagged,
		revealed: revealed,
	};
	return cell;
}

function handleCellInput(minesweeper: Minesweeper, input: KeyboardInput, cell: CellInfo, sounds: SoundManager): void {
	cell.hovered = isInsideRect(input.getMousePosition(), cell.rect);
	if (cell.revealed && cell.value === NONE) {
		cell.hovered = false;
	}
	// TODO: Instead of always have this as a shortcut, have a button that activates "hint" mode
	//       and display the amount of hints used in a game to make player conscious of using them.
	cell.hinted = DEV && cell.hovered && input.isDown('KeyH');

	if (minesweeper.generated && cell.hovered && !cell.revealed) {
		if (!cell.flagged && input.isPressed('MouseLeft')) {
			void sounds.play('click');
			cell.revealed = true;
			const exploded = revealCell(minesweeper.field, cell.row, cell.col);
			if (exploded) {
				minesweeper.done = true;
				minesweeper.failed = true;
				void sounds.play('lost');
			} else {
				if (finishGameIfSolved(minesweeper)) void sounds.play('win');
			}
			console.debug(`Revealed cell at ${cell.row}:${cell.col}`);
		}
		if (input.isPressed('MouseRight')) {
			if (!cell.flagged && countFlags(minesweeper.field) >= minesweeper.field.minesCount) return;
			void sounds.play('click');
			console.debug(`Flagged cell at ${cell.row}:${cell.col}`);
			toggleCellFlag(minesweeper.field, cell.row, cell.col);
			cell.flagged = !cell.flagged;
			if (finishGameIfSolved(minesweeper)) void sounds.play('win');
		}
		return;
	}

	const value = minesweeper.field.data[cell.row][cell.col];
	if (minesweeper.generated && cell.hovered && cell.revealed && value > NONE && input.isPressed('MouseLeft')) {
		const { changed, exploded } = chordeCell(minesweeper.field, cell.row, cell.col);
		if (!changed) return;
		void sounds.play('click');
		if (exploded) {
			minesweeper.done = true;
			minesweeper.failed = true;
			void sounds.play('lost');
		} else {
			if (finishGameIfSolved(minesweeper)) void sounds.play('win');
		}
		return;
	}

	if (!minesweeper.generated && cell.hovered && !cell.revealed && input.isPressed('MouseLeft')) {
		void sounds.play('click');
		generateMinefield(minesweeper, indexOf(cell.row, cell.col, minesweeper.field.cols));
		cell.revealed = true;
		minesweeper.generated = true;
		if (finishGameIfSolved(minesweeper)) void sounds.play('win');
	}
}

function drawTopbar(r: Renderer2d, minesweeper: Minesweeper, config: GameConfig, images: GameImages) {
	r.context.textBaseline = config.textBaseline;
	r.context.textAlign = config.textAlign;
	r.drawRectRounded(
		{ x: config.gridXOffset, y: config.topbarYOffset, width: config.gridWidth, height: config.topbarHeight },
		TOPBAR_RADIUS,
		Color.CELL_EMPTY,
	);
	const topbarYCenter = config.topbarYOffset + config.topbarHeight / 2;
	const paddingX = config.topbarHeight * 0.1;
	const time = minesweeper.generated ? minesweeper.time : 0;
	const minesRemaining = minesweeper.generated
		? Math.max(0, minesweeper.field.minesCount - countFlags(minesweeper.field))
		: minesweeper.expectedMinesCount;
	r.setFont(config.topbarFont);
	{
		let x = config.gridXOffset + paddingX;
		r.drawImage(images.clock, x, config.topbarIconY, config.topbarIconSize, config.topbarIconSize);
		x += config.topbarIconSize + paddingX;
		let text = timeToHumanString(time);
		let m = r.measureText(text);
		let textY = topbarYCenter;
		{
			x += m.width / 2;
			const ascentDiff = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent;
			textY += ascentDiff / 2;
			r.drawText(text, { x, y: textY }, Color.TEXT_TOPBAR);
		}
	}
	{
		let image: HTMLImageElement | undefined;
		if (minesweeper.generated && minesweeper.done) {
			image = minesweeper.failed ? images.smileyDead : images.smileyCool;
		} else {
			image = images.smiley;
		}
		const smileyRect = getSmileyRect(config);
		r.drawImage(image, smileyRect.x, smileyRect.y, smileyRect.width, smileyRect.height);
	}
	{
		// Start from the right edge of the grid
		let x = config.gridXOffset + config.gridWidth;
		{
			x -= config.topbarIconSize;
			x -= paddingX;
			r.drawImage(images.mine, x, config.topbarIconY, config.topbarIconSize, config.topbarIconSize);
		}
		const text = minesRemaining.toString().padStart(3, '0');
		const m = r.measureText(text);
		let textY = topbarYCenter;
		{
			x -= paddingX + m.width / 2;
			const ascentDiff = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent;
			textY += ascentDiff / 2;
			r.drawText(text, { x, y: textY }, Color.TEXT_TOPBAR);
		}
	}
}

function getSmileyRect(config: GameConfig): Rect {
	return {
		x: config.gridXOffset + config.gridWidth / 2 - config.topbarIconSize / 2,
		y: config.topbarYOffset + config.topbarHeight / 2 - config.topbarIconSize / 2,
		width: config.topbarIconSize,
		height: config.topbarIconSize,
	};
}

function drawCell(r: Renderer2d, config: GameConfig, minesweeper: Minesweeper, cell: CellInfo): void {
	let cellColor = Color.CELL;
	const value = minesweeper.field.data[cell.row][cell.col];
	if (cell.flagged && !config.debugReveal) {
		if (cell.hovered) {
			cellColor = Color.CELL_HOVER;
		}
		if ((minesweeper.done || config.debugReveal) && value !== MINE) {
			cellColor = Color.CELL_WRONG;
		}
		r.drawRectRounded(cell.rect, CELL_RADIUS, cellColor);
		r.drawImage(config.images.flag, cell.x, cell.y, config.cellSize, config.cellSize);
	} else if (value === MINE && (minesweeper.done || config.debugReveal || cell.hinted)) {
		if (cell.revealed) {
			cellColor = Color.CELL_EXPLODED;
		} else {
			cellColor = Color.CELL_EMPTY;
		}
		r.drawRectRounded(cell.rect, CELL_RADIUS, cellColor);
		const image = minesweeper.done && cell.revealed ? config.images.mineExploded : config.images.mine;
		r.drawImage(image, cell.x, cell.y, config.cellSize, config.cellSize);
	} else if (cell.revealed || config.debugReveal || cell.hinted) {
		if (value === NONE) {
			r.drawRectRounded(cell.rect, CELL_RADIUS, Color.CELL_EMPTY);
		} else {
			cellColor = numberToColor(value);
			r.drawRectRounded(cell.rect, CELL_RADIUS, cellColor);
			const text = String(value);
			const textPosition = v2Clone(cell.center);
			const textMetrics = r.measureText(text);
			// NOTE: Often ascent and descent are not equal, so we need to center the text vertically.
			const ascentDiff = textMetrics.actualBoundingBoxAscent - textMetrics.actualBoundingBoxDescent;
			textPosition.y += ascentDiff / 2;
			r.drawText(text, textPosition, Color.CELL_TEXT);
		}
	} else {
		if (cell.hovered) {
			cellColor = Color.CELL_HOVER;
		}
		r.drawRectRounded(cell.rect, CELL_RADIUS, cellColor);
	}
	// NOTE: Used for debugging.
	// if (config.debugReveal) {
	// 	let text = 'U';
	// 	if (cell.revealed) text = 'R';
	// 	if (cell.flagged) text = 'F';
	// 	r.drawText(text, cell.center, '#fff');
	// }
}

function initColors(): void {
	setColors(getComputedStyle(document.documentElement));
	if (import.meta.hot) {
		import.meta.hot.on('vite:afterUpdate', () => {
			console.debug('Styles hot reloaded');
			setColors(getComputedStyle(document.documentElement));
		});
	}
}

function setColors(styles: CSSStyleDeclaration): void {
	for (const [colorName, varName] of Object.entries(ColorVar)) {
		const colorValue = styles.getPropertyValue(varName);
		if (colorValue) {
			Color[colorName as keyof typeof Color] = colorValue;
		} else {
			console.warn(`Color "${colorName}" not found for "${varName}"`);
		}
	}
}

// [N, NE, E, SE, S, SW, W, NW]
const OFFSETS = [
	[-1, 0],
	[-1, 1],
	[0, 1],
	[1, 1],
	[1, 0],
	[1, -1],
	[0, -1],
	[-1, -1],
];
const MINE = -1;
const NONE = 0;

const Flag = {
	UNKNOWN: 0,
	FLAGGED: 1,
	REVEALED: 2,
} as const;
type Flag = (typeof Flag)[keyof typeof Flag];

const MAX_GENERATION_ATTEMPTS = 100;
function generateMinefield(minesweeper: Minesweeper, targetIndex: number, seed?: string): void {
	const minefield = minesweeper.field;
	const cols = minefield.cols;
	const rows = minefield.rows;
	const targetRow = rowOf(targetIndex, cols);
	const targetCol = colOf(targetIndex, cols);
	seed ??= Date.now().toString();
	const random = Random.fromSeed(seed);
	console.debug(
		`Generating ${minesweeper.expectedMinesCount} mines for [${rows}x${cols}] with seed "${seed}" at [${targetRow};${targetCol}]`,
	);

	minesweeper.solved = false;
	minefield.minesCount = minesweeper.expectedMinesCount;
	let attempt = 0;
	let startTime = performance.now();
	const solver = new Solver(minesweeper.field);
	for (; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
		if (attempt % 5 === 0) {
			if (attempt >= 50) {
				minesweeper.expectedMinesCount -= 1;
				const minMinesCount = Math.round(rows * cols * 0.15);
				if (minesweeper.expectedMinesCount < minMinesCount) {
					minesweeper.expectedMinesCount = minMinesCount;
				}
			}
			minefield.minesCount = minesweeper.expectedMinesCount;
			matrix2Fill(minefield.data, NONE);
			placeMinefieldMines(minefield, targetIndex, random);
		} else {
			shuffleUnknownCells(minefield, random);
		}
		placeMinefieldNumbers(minefield);
		minesweeper.field = minefield;
		minefield.flags = minesweeper.playerFlags;
		matrix2Fill(minefield.flags, Flag.UNKNOWN);
		revealCell(minefield, targetRow, targetCol);

		matrix2SetFrom(minesweeper.solverFlags, minefield.flags);
		matrix2SetFrom(minesweeper.originalFlags, minefield.flags);
		minefield.flags = minesweeper.solverFlags;
		const solved = solver.trySolve();
		minefield.flags = minesweeper.playerFlags;
		if (solved) {
			minesweeper.solved = true;
			break;
		}
	}
	const timeTook = performance.now() - startTime;
	if (minesweeper.solved) {
		console.debug(`[Generator] Minefield generated, took ${attempt} attempts and ${timeTook}ms`);
	} else {
		console.error(`[Generator] Failed to generate a solvable minefield, tried ${attempt} times in ${timeTook}ms`);
	}
}

function placeMinefieldMines(minefield: Minefield, targetIndex: number, random: Random): void {
	const { rows, cols, data, minesCount } = minefield;
	const targetRow = rowOf(targetIndex, cols);
	const targetCol = colOf(targetIndex, cols);
	const cellsCount = rows * cols;
	const indices: number[] = [];
	{
		for (let index = 0; index < cellsCount; index++) {
			const row = rowOf(index, cols);
			const col = colOf(index, cols);
			// NOTE: Skipping tiles near target because that's where the player has clicked.
			const isSafe = Math.abs(row - targetRow) <= 1 && Math.abs(col - targetCol) <= 1;
			if (!isSafe) {
				indices.push(index);
			}
		}
	}

	// Partial Fisher-Yates shuffle
	for (let i = 0; i < minesCount; i++) {
		const j = i + random.int32Range(0, indices.length - i);
		{
			const temp = indices[i];
			indices[i] = indices[j];
			indices[j] = temp;
		}
		const index = indices[i];
		data[rowOf(index, cols)][colOf(index, cols)] = MINE;
	}
}

function placeMinefieldNumbers(minefield: Minefield): void {
	const { rows, cols, data } = minefield;
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			if (data[row][col] === MINE) continue;
			let neighborMines = 0;
			for (const [rowOffset, colOffset] of OFFSETS) {
				const neighborRow = row + rowOffset;
				const neighborCol = col + colOffset;
				if (
					neighborRow >= 0 &&
					neighborRow < rows &&
					neighborCol >= 0 &&
					neighborCol < cols &&
					data[neighborRow][neighborCol] === MINE
				) {
					neighborMines += 1;
				}
			}
			data[row][col] = neighborMines;
		}
	}
}

function shuffleUnknownCells(minefield: Minefield, random: Random): void {
	const cols = minefield.cols;
	const unknownIndices: number[] = [];
	for (let index of allIndices(minefield)) {
		const flag = getCellFlagByIndex(minefield, index);
		if (flag === Flag.UNKNOWN) {
			unknownIndices.push(index);
		}
	}
	for (let i = 0; i < unknownIndices.length; i++) {
		const j = i + random.int32Range(0, unknownIndices.length - i);
		{
			const temp = unknownIndices[i];
			unknownIndices[i] = unknownIndices[j];
			unknownIndices[j] = temp;
		}
		const indexI = unknownIndices[i];
		const indexJ = unknownIndices[j];
		const rowI = rowOf(indexI, cols);
		const colI = colOf(indexI, cols);
		const rowJ = rowOf(indexJ, cols);
		const colJ = colOf(indexJ, cols);
		const temp = minefield.data[rowI][colI];
		minefield.data[rowI][colI] = minefield.data[rowJ][colJ];
		minefield.data[rowJ][colJ] = temp;
		minefield.flags[rowI][colI] = Flag.UNKNOWN;
		minefield.flags[rowJ][colJ] = Flag.UNKNOWN;
	}
}

function emptyMinefield(rows: number, cols: number): Minefield {
	return {
		rows,
		cols,
		data: Array.from({ length: rows }, () => Array(cols).fill(NONE)),
		minesCount: 0,
		flags: Array.from({ length: rows }, () => Array(cols).fill(Flag.UNKNOWN)),
	};
}

function revealCell(minefield: Minefield, row: number, col: number): boolean {
	if (!isInsideMinefield(minefield, row, col)) return false;
	if (minefield.flags[row][col] === Flag.FLAGGED) return false;
	if (minefield.flags[row][col] === Flag.REVEALED) return false;
	const value = minefield.data[row][col];
	minefield.flags[row][col] = Flag.REVEALED;
	if (value === MINE) return true;
	if (value === NONE) {
		for (const [offsetRow, offsetCol] of OFFSETS) {
			const neighborRow = row + offsetRow;
			const neighborCol = col + offsetCol;
			revealCell(minefield, neighborRow, neighborCol);
		}
	}
	return false;
}

function flagCell(minefield: Minefield, row: number, col: number): boolean {
	const flag = minefield.flags[row][col];
	if (flag === Flag.REVEALED) {
		console.warn(`[WARNING]: Trying to flag a revealed cell at (${row}:${col})`);
		return false;
	}
	if (flag === Flag.FLAGGED) {
		console.warn(`[WARNING]: Trying to flag an already flagged cell at (${row}:${col})`);
		return false;
	}
	minefield.flags[row][col] = Flag.FLAGGED;
	return true;
}

function unflagCell(minefield: Minefield, row: number, col: number): void {
	const flag = minefield.flags[row][col];
	if (flag === Flag.REVEALED) {
		console.warn(`[WARNING]: Trying to unflag a revealed cell at (${row}:${col})`);
		return;
	}
	if (flag === Flag.UNKNOWN) {
		console.warn(`[WARNING]: Trying to unflag an unknown cell at (${row}:${col})`);
		return;
	}
	minefield.flags[row][col] = Flag.UNKNOWN;
}

function toggleCellFlag(minefield: Minefield, row: number, col: number): void {
	if (minefield.flags[row][col] === Flag.FLAGGED) {
		unflagCell(minefield, row, col);
	} else {
		flagCell(minefield, row, col);
	}
}

/**
 * NOTE: When a number has the correct amount of flags, you can click on the number to open all the cells around it.
 * This is called a chord because in older versions it required pressing two buttons, left + right, at the same time.
 */
function chordeCell(minefield: Minefield, row: number, col: number): { changed: boolean; exploded: boolean } {
	if (minefield.flags[row][col] !== Flag.REVEALED) return { changed: false, exploded: false };
	const value = minefield.data[row][col];
	if (value <= NONE) return { changed: false, exploded: false };

	let nearFlagsCount = 0;
	for (const [offsetRow, offsetCol] of OFFSETS) {
		const neighborRow = row + offsetRow;
		const neighborCol = col + offsetCol;
		if (minefield.flags?.[neighborRow]?.[neighborCol] === Flag.FLAGGED) {
			nearFlagsCount++;
		}
	}
	if (nearFlagsCount != value) return { changed: false, exploded: false };

	let changed = false;
	let anyExploded = false;
	for (const [offsetRow, offsetCol] of OFFSETS) {
		const neighborRow = row + offsetRow;
		const neighborCol = col + offsetCol;
		if (minefield.flags?.[neighborRow]?.[neighborCol] === Flag.UNKNOWN) {
			changed = true;
			const exploded = revealCell(minefield, neighborRow, neighborCol);
			anyExploded ||= exploded;
		}
	}
	return { changed, exploded: anyExploded };
}

function indexOf(row: number, col: number, cols: number): number {
	return row * cols + col;
}
function rowOf(index: number, cols: number): number {
	return Math.floor(index / cols);
}
function colOf(index: number, cols: number): number {
	return index % cols;
}

function isInsideMinefield(minefield: Minefield, row: number, col: number): boolean {
	return row >= 0 && row < minefield.rows && col >= 0 && col < minefield.cols;
}

function getCellValue(minefield: Minefield, row: number, col: number): number | undefined {
	return minefield.data?.[row]?.[col];
}

function getCellFlag(minefield: Minefield, row: number, col: number): number | undefined {
	return minefield.flags?.[row]?.[col];
}

function getCellFlagByIndex(minefield: Minefield, index: number): number | undefined {
	return getCellFlag(minefield, rowOf(index, minefield.cols), colOf(index, minefield.cols));
}

function isCellFlagged(minefield: Minefield, index: number): boolean {
	return getCellFlagByIndex(minefield, index) === Flag.FLAGGED;
}

function isCellRevealed(minefield: Minefield, index: number): boolean {
	return getCellFlagByIndex(minefield, index) === Flag.REVEALED;
}

function isSolved(minefield: Minefield): boolean {
	for (let row = 0; row < minefield.rows; row++) {
		for (let col = 0; col < minefield.cols; col++) {
			if (minefield.data[row][col] !== MINE && getCellFlag(minefield, row, col) !== Flag.REVEALED) {
				return false;
			}
		}
	}
	return true;
}

function finishGameIfSolved(minesweeper: Minesweeper): boolean {
	if (!isSolved(minesweeper.field)) return false;

	for (let row = 0; row < minesweeper.field.rows; row++) {
		for (let col = 0; col < minesweeper.field.cols; col++) {
			if (minesweeper.field.data[row][col] === MINE) {
				minesweeper.field.flags[row][col] = Flag.FLAGGED;
			}
		}
	}
	minesweeper.done = true;
	minesweeper.failed = false;
	return true;
}

function countFlags(minefield: Minefield): number {
	let count = 0;
	for (let row = 0; row < minefield.rows; row++) {
		for (let col = 0; col < minefield.cols; col++) {
			if (getCellFlag(minefield, row, col) === Flag.FLAGGED) count++;
		}
	}
	return count;
}

function numberToColor(number: number): string {
	switch (number) {
		case 1:
			return Color.NUMBER1;
		case 2:
			return Color.NUMBER2;
		case 3:
			return Color.NUMBER3;
		case 4:
			return Color.NUMBER4;
		case 5:
			return Color.NUMBER5;
		case 6:
			return Color.NUMBER6;
		case 7:
			return Color.NUMBER7;
		case 8:
			return Color.NUMBER8;
		default:
			return Color.NUMBER1;
	}
}

type GameImages = {
	flag: HTMLImageElement;
	mine: HTMLImageElement;
	mineExploded: HTMLImageElement;
	clock: HTMLImageElement;
	smiley: HTMLImageElement;
	smileyCool: HTMLImageElement;
	smileyDead: HTMLImageElement;
};

async function loadImages(): Promise<GameImages> {
	const flagImage = new Image();
	flagImage.src = './flag.png';
	const mineImage = new Image();
	mineImage.src = './mine.png';
	const mineExplodedImage = new Image();
	mineExplodedImage.src = './mine-exploded.png';
	const clockImage = new Image();
	clockImage.src = './clock.png';
	const smileyImage = new Image();
	smileyImage.src = './smiley.png';
	const smileyCoolImage = new Image();
	smileyCoolImage.src = './smiley-cool.png';
	const smileyDeadImage = new Image();
	smileyDeadImage.src = './smiley-dead.png';
	await Promise.all([
		flagImage.decode(),
		mineImage.decode(),
		mineExplodedImage.decode(),
		clockImage.decode(),
		smileyImage.decode(),
		smileyCoolImage.decode(),
		smileyDeadImage.decode(),
	]);
	return {
		flag: flagImage,
		mine: mineImage,
		mineExploded: mineExplodedImage,
		clock: clockImage,
		smiley: smileyImage,
		smileyCool: smileyCoolImage,
		smileyDead: smileyDeadImage,
	};
}

function* neighborIndices(minefield: Minefield, index: number): Generator<number> {
	for (const [rowOffset, colOffset] of OFFSETS) {
		const neighborRow = rowOf(index, minefield.cols) + rowOffset;
		const neighborCol = colOf(index, minefield.cols) + colOffset;
		if (!isInsideMinefield(minefield, neighborRow, neighborCol)) continue;
		yield indexOf(neighborRow, neighborCol, minefield.cols);
	}
}

function* allIndices(minefield: Minefield): Generator<number> {
	for (let row = 0; row < minefield.data.length; row++) {
		for (let col = 0; col < minefield.data[row].length; col++) {
			yield indexOf(row, col, minefield.cols);
		}
	}
}

type Constraint = {
	cells: Set<number>; // flattened field indices
	minesCount: number;
};

function constraintEquals(a: Constraint, b: Constraint): boolean {
	return a.minesCount === b.minesCount && a.cells.size === b.cells.size && a.cells.isSupersetOf(b.cells);
}

function isConstraintEmpty(constraint: Constraint): boolean {
	return constraint.cells.size === 0 && constraint.minesCount === 0;
}

class Solver {
	minefield: Minefield;
	constraints: Constraint[] = [];
	todoConstraints: Constraint[] = [];
	todoKnownCells: number[] = [];
	changed = false;

	constructor(minefield: Minefield) {
		this.minefield = minefield;
	}

	get minesCount(): number {
		return this.minefield.minesCount;
	}

	reset(): void {
		this.constraints.length = 0;
		this.todoConstraints.length = 0;
		this.todoKnownCells.length = 0;
		this.changed = false;
	}

	trySolve(): boolean {
		this.reset();
		for (const index of allIndices(this.minefield)) {
			if (isCellRevealed(this.minefield, index)) {
				this.todoKnownCells.push(index);
			}
		}
		while (true) {
			let changed = false;

			while (this.todoKnownCells.length > 0) {
				const index = this.todoKnownCells.pop();
				if (index == null) throw new Error('[Solver] index must not be nullable');
				if (isCellRevealed(this.minefield, index)) {
					changed = this.addConstraintByIndex(index) || changed;
				}
				changed = this.reduceConstrainsMineCountForIndex(index) > 0 || changed;
			}
			this.constraints = this.constraints.filter((c) => !isConstraintEmpty(c));

			const constraint = this.todoConstraints.pop();
			if (constraint != null) {
				if (isConstraintEmpty(constraint)) continue;
				if (constraint.minesCount === 0) {
					for (const index of constraint.cells) {
						changed = this.revealCell(index) || changed;
					}
				}
				if (constraint.minesCount === constraint.cells.size) {
					for (const index of constraint.cells) {
						changed = this.flagCell(index) || changed;
					}
				}
				for (const otherConstraint of this.constraints) {
					if (otherConstraint === constraint) continue;
					changed = this.checkConstraintsDeltas(constraint, otherConstraint) || changed;
					changed = this.checkOverlappingConstraints(constraint, otherConstraint) || changed;
				}
				continue;
			}

			if (!changed) {
				changed = this.tryGlobalMineCountDeduction() || changed;
			}

			if (!changed) {
				break;
			}
		}
		const solved = isSolved(this.minefield);
		return solved;
	}

	private addConstraintByIndex(index: number): boolean {
		const unknownNeighbors: Set<number> = new Set();
		const minefield = this.minefield;
		const row = rowOf(index, minefield.cols);
		const col = colOf(index, minefield.cols);
		const value = getCellValue(minefield, row, col);
		if (value == null) {
			throw new Error(`Cell at index ${index} is out of bounds`);
		}
		let minesToFindCount = value;
		for (const neighborIndex of neighborIndices(minefield, index)) {
			const flag = getCellFlag(
				minefield,
				rowOf(neighborIndex, minefield.cols),
				colOf(neighborIndex, minefield.cols),
			);
			if (flag === Flag.FLAGGED) {
				minesToFindCount -= 1;
			} else if (flag === Flag.UNKNOWN) {
				unknownNeighbors.add(neighborIndex);
			}
		}
		if (minesToFindCount < 0) {
			throw new Error(
				`Constraint is inconsistent: ${minesToFindCount} mines found, but only ${value} are allowed`,
			);
		}
		if (unknownNeighbors.size > 0) {
			this.addConstraint({ cells: unknownNeighbors, minesCount: minesToFindCount });
			return true;
		}
		return false;
	}

	private addConstraint(constraint: Constraint): boolean {
		if (constraint.cells.size === 0) {
			if (constraint.minesCount !== 0) {
				throw new Error(
					`Constraint is inconsistent: ${constraint.minesCount} mines found, but only 0 are allowed`,
				);
			}
			return false;
		}
		if (constraint.minesCount < 0 || constraint.minesCount > constraint.cells.size) {
			throw new Error(
				`Constraint is inconsistent: ${constraint.minesCount} mines found, but only 0-${constraint.cells.size} are allowed`,
			);
		}
		for (const existing of this.constraints) {
			if (constraintEquals(existing, constraint)) {
				return false;
			}
		}
		this.constraints.push(constraint);
		this.todoConstraints.push(constraint);
		return true;
	}

	private reduceConstrainsMineCountForIndex(index: number): number {
		let updatedCount = 0;
		const flag = getCellFlagByIndex(this.minefield, index);
		if (flag === Flag.UNKNOWN) return updatedCount;
		const isMine = flag === Flag.FLAGGED;
		for (const constraint of this.constraints) {
			if (!constraint.cells.has(index)) continue;
			constraint.cells.delete(index);
			if (isMine) {
				constraint.minesCount -= 1;
			}
			this.todoConstraints.push(constraint);
			updatedCount++;
		}
		return updatedCount;
	}

	private checkConstraintsDeltas(a: Constraint, b: Constraint): boolean {
		if (a.cells.isSubsetOf(b.cells)) {
			const deltaCells = b.cells.difference(a.cells);
			const deltaMinesCount = b.minesCount - a.minesCount;
			return this.addConstraint({ cells: deltaCells, minesCount: deltaMinesCount });
		} else if (b.cells.isSubsetOf(a.cells)) {
			const deltaCells = a.cells.difference(b.cells);
			const deltaMinesCount = a.minesCount - b.minesCount;
			return this.addConstraint({ cells: deltaCells, minesCount: deltaMinesCount });
		}
		return false;
	}

	private checkOverlappingConstraints(a: Constraint, b: Constraint): boolean {
		const sharedCells = a.cells.intersection(b.cells);
		const aOnlyCells = a.cells.difference(sharedCells);
		const bOnlyCells = b.cells.difference(sharedCells);
		const deltaMinesCount = a.minesCount - b.minesCount;
		let changed = false;

		if (deltaMinesCount === aOnlyCells.size) {
			for (const index of aOnlyCells) {
				changed = this.flagCell(index) || changed;
			}
			for (const index of bOnlyCells) {
				changed = this.revealCell(index) || changed;
			}
		}
		if (-deltaMinesCount === bOnlyCells.size) {
			for (const index of aOnlyCells) {
				changed = this.revealCell(index) || changed;
			}
			for (const index of bOnlyCells) {
				changed = this.flagCell(index) || changed;
			}
		}
		return changed;
	}

	private tryGlobalMineCountDeduction(): boolean {
		let knownMines = 0;
		const unknownCells: number[] = [];

		for (const index of allIndices(this.minefield)) {
			if (isCellFlagged(this.minefield, index)) {
				knownMines++;
			} else if (!isCellRevealed(this.minefield, index)) {
				unknownCells.push(index);
			}
		}

		if (unknownCells.length === 0) return false;

		const remainingMinesCount = this.minesCount - knownMines;
		const remainingSafeCount = unknownCells.length - remainingMinesCount;

		if (remainingMinesCount === 0) {
			for (const index of unknownCells) this.revealCell(index);
			return true;
		}

		if (remainingSafeCount === 0) {
			for (const index of unknownCells) this.flagCell(index);
			return true;
		}

		// TODO: Understand these.
		const mineConstraints = this.findDisjointConstraintGroups(
			this.constraints,
			remainingMinesCount,
			(c) => c.minesCount,
		);
		if (mineConstraints) {
			let changed = false;
			const coveredCells = this.getAllConstraintCells(mineConstraints);
			for (const index of unknownCells) {
				if (!coveredCells.has(index)) {
					this.revealCell(index);
					changed = true;
				}
			}

			return changed;
		}

		const safeConstraints = this.findDisjointConstraintGroups(
			this.constraints,
			remainingSafeCount,
			(c) => c.cells.size - c.minesCount,
		);
		if (safeConstraints) {
			let changed = false;
			const coveredCells = this.getAllConstraintCells(safeConstraints);
			for (const index of unknownCells) {
				if (!coveredCells.has(index)) {
					this.flagCell(index);
					changed = true;
				}
			}

			return changed;
		}

		return false;
	}

	private findDisjointConstraintGroups(
		constraints: Constraint[],
		target: number,
		getValue: (constraint: Constraint) => number,
	): Constraint[] | null {
		const MAX_CONSTRAINTS = 500;
		const MAX_SEARCH_STATES = 100_000;
		if (constraints.length > MAX_CONSTRAINTS) return null;
		const group: Constraint[] = [];
		const usedCells = new Set<number>();
		let searchedStates = 0;
		let searchLimitReached = false;

		function search(startIndex: number, value: number): Constraint[] | null {
			searchedStates++;
			if (searchedStates > MAX_SEARCH_STATES) {
				searchLimitReached = true;
				return null;
			}
			if (value === target) {
				return group.slice();
			}

			if (value > target) {
				return null;
			}

			for (let constraintIndex = startIndex; constraintIndex < constraints.length; constraintIndex++) {
				const constraint = constraints[constraintIndex];
				const constraintValue = getValue(constraint);
				if (constraintValue === 0) continue;

				let overlaps = false;

				for (const cell of constraint.cells) {
					if (usedCells.has(cell)) {
						overlaps = true;
						break;
					}
				}

				if (overlaps) continue;

				const nextValue = value + constraintValue;

				// Important pruning
				if (nextValue > target) continue;

				group.push(constraint);
				for (const cell of constraint.cells) usedCells.add(cell);

				const result = search(constraintIndex + 1, nextValue);
				if (result || searchLimitReached) return result;

				group.pop();
				for (const cell of constraint.cells) usedCells.delete(cell);
			}

			return null;
		}

		return search(0, 0);
	}

	private getAllConstraintCells(constraints: Constraint[]): Set<number> {
		const cells = new Set<number>();
		for (const constraint of constraints) {
			for (const cell of constraint.cells) {
				cells.add(cell);
			}
		}
		return cells;
	}

	private flagCell(index: number): boolean {
		const { minefield } = this;
		if (isCellFlagged(minefield, index)) return false;
		const ok = flagCell(minefield, rowOf(index, minefield.cols), colOf(index, minefield.cols));
		if (ok) {
			this.todoKnownCells.push(index);
		}
		return ok;
	}

	private revealCell(index: number): boolean {
		const { minefield } = this;
		const row = rowOf(index, minefield.cols);
		const col = colOf(index, minefield.cols);
		if (!isInsideMinefield(minefield, row, col)) return false;
		if (minefield.flags[row][col] === Flag.FLAGGED) return false;
		if (minefield.flags[row][col] === Flag.REVEALED) return false;
		const value = minefield.data[row][col];
		minefield.flags[row][col] = Flag.REVEALED;
		if (value === MINE) return true;
		if (value === NONE) {
			for (const neighborIndex of neighborIndices(minefield, index)) {
				this.revealCell(neighborIndex);
			}
		}
		this.todoKnownCells.push(index);
		return true;
	}
}

function matrix2Fill(matrix: number[][], value: number): void {
	for (let i = 0; i < matrix.length; i++) {
		for (let j = 0; j < matrix[i].length; j++) {
			matrix[i][j] = value;
		}
	}
}

function matrix2SetFrom(target: number[][], source: number[][]): void {
	if (target.length !== source.length || target[0]?.length !== source[0]?.length) {
		throw new Error('Matrices must have the same dimensions');
	}
	for (let i = 0; i < target.length; i++) {
		for (let j = 0; j < target[i].length; j++) {
			target[i][j] = source[i][j];
		}
	}
}

function timeToHumanString(time: number): string {
	const seconds = Math.floor(time / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

main();
