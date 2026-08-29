import { isInsideRect, v2Clone, type Rect, type Vec2 } from '$math';
import { KeyboardInput } from './input';
import { Random } from './random';
import { Renderer2d, type FontRendered } from './renderer';
import './style.css';

/*
TODO:
- Retry minefield generation if solver failed.
- Add a cool win animation.
- Add a cool lose animation (some kind of explosion?).
- Add a clock.
- Add a scoreboard.
- Add sounds (with mute option).
- Allow optionally specifying the seed for minefield generation in the URL.
- Add a second "theme" where number color is displayed as text instead of a background.
*/

const Color = {
	BACKGROUND: '--color-bg',
	CELL: '--color-cell',
	CELL_HOVER: '--color-cell-hover',
	CELL_EMPTY: '--color-cell-empty',
	CELL_WRONG: '--color-cell-wrong',
	CELL_EXPLODED: '--color-cell-exploded',
	TEXT: '--color-text',
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
	minesCount: number;
	generated: boolean;
	solved: boolean;
	done: boolean;
};

type Minefield = {
	rows: number;
	cols: number;
	data: number[][]; // -1 = mine, 0 = empty, 1-8 = number of mines around
	flags: number[][]; // 0 = unknown, 1 = flagged, 2 = revealed
};

const PADDING_WINDOW = 0.05;
const PADDING_CELL = 0.1;
const CELL_RADIUS = 4;
const DEFAULT_MINES_COUNT = 99;
const DEFAULT_ROWS = 16;
const DEFAULT_COLS = 30;

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
	const context = canvas.getContext('2d');
	if (!context) {
		console.error('[ERROR]: Canvas context not supported');
		return;
	}

	const savedMinesweeper = storage.getItem('minesweeper');
	if (savedMinesweeper) {
		globalThis.minesweeper = JSON.parse(savedMinesweeper);
		minesweeper!.playerFlags = minesweeper!.field.flags;
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

	let showSolverFlags = false;

	const tick = () => {
		if (!globalThis.minesweeper || input.isPressed('KeyR')) {
			console.log('INFO: Initializing minesweeper');
			const field = emptyMinefield(rows, cols);
			globalThis.minesweeper = {
				field: field,
				playerFlags: field.flags,
				originalFlags: field.flags.map((r) => r.slice()),
				solverFlags: field.flags.map((r) => r.slice()),
				minesCount: DEFAULT_MINES_COUNT,
				generated: false,
				done: false,
				solved: false,
			};
		}
		const minesweeper = globalThis.minesweeper;

		r.fillScreen(Color.BACKGROUND);

		const config = computeConfig(canvas, minesweeper, images);
		config.debugReveal = input.isDown('Space');
		let isAnyHovered = false;
		if (minesweeper.done && input.isPressed('KeyP')) {
			globalThis.minesweeper = {
				...minesweeper,
				done: false,
				playerFlags: minesweeper.originalFlags.map((r) => r.slice()),
			};
		}

		if (input.isPressed('KeyS')) {
			showSolverFlags = !showSolverFlags;
		}
		minesweeper.field.flags = showSolverFlags ? minesweeper.solverFlags : minesweeper.playerFlags;

		if (input.isPressed('KeyE')) {
			trySolve(minesweeper);
		}
		if (input.isPressed('KeyQ')) {
			resetSolverFlags(minesweeper);
		}

		r.setFont(config.font);
		r.context.textBaseline = config.textBaseline;
		r.context.textAlign = config.textAlign;

		for (let row = 0; row < minesweeper.field.rows; row++) {
			for (let col = 0; col < minesweeper.field.cols; col++) {
				try {
					const cell = computeCell(config, minesweeper.field, row, col);
					if (!minesweeper.done) {
						handleCellInput(minesweeper, input, cell);
					}
					drawCell(r, config, minesweeper, cell);
					isAnyHovered ||= cell.hovered;
				} catch (e) {
					console.error(e);
					// debugger;
					// throw e;
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

type GameConfig = {
	cellSize: number;
	cellPadding: number;
	gridWidth: number;
	gridHeight: number;
	gridXOffset: number;
	gridYOffset: number;
	font: FontRendered;
	textBaseline: CanvasTextBaseline;
	textAlign: CanvasTextAlign;
	debugReveal: boolean;
	images: GameImages;
};

function computeConfig(canvas: HTMLCanvasElement, minesweeper: Minesweeper, images: GameImages): GameConfig {
	const { rows, cols } = minesweeper.field;
	const windowPadding = Math.min(canvas.width, canvas.height) * PADDING_WINDOW;
	const containerWidth = canvas.width - windowPadding * 2;
	const containerHeight = canvas.height - windowPadding * 2;
	const rawCellWidth = containerWidth / cols;
	const rawCellHeight = containerHeight / cols;
	const rawCellSize = Math.min(rawCellWidth, rawCellHeight);
	const cellPadding = rawCellSize * PADDING_CELL;
	const cellSizeX = (containerWidth - cellPadding * (cols - 1)) / cols;
	const cellSizeY = (containerHeight - cellPadding * (rows - 1)) / rows;
	const cellSize = Math.min(cellSizeX, cellSizeY);
	const gridWidth = cols * cellSize + (cols - 1) * cellPadding;
	const gridHeight = rows * cellSize + (rows - 1) * cellPadding;
	const gridXOffset = (canvas.width - gridWidth) / 2;
	const gridYOffset = (canvas.height - gridHeight) / 2;

	const fontSize = cellSize * 0.8;
	const font: FontRendered = { size: fontSize, weight: 700, family: 'Arial' };
	return {
		cellSize,
		cellPadding,
		gridWidth,
		gridHeight,
		gridXOffset,
		gridYOffset,
		images,
		font,
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
	const flagged = minefield.flags[row][col] === Flags.FLAGGED;
	const revealed = minefield.flags[row][col] === Flags.REVEALED;
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

function handleCellInput(minesweeper: Minesweeper, input: KeyboardInput, cell: CellInfo): void {
	cell.hovered = isInsideRect(input.getMousePosition(), cell.rect);
	if (cell.revealed && cell.value === NONE) {
		cell.hovered = false;
	}
	// TODO: Instead of always have this as a shortcut, have a button that activates "hint" mode
	//       and display the amount of hints used in a game to make player conscious of using them.
	cell.hinted = cell.hovered && input.isDown('KeyH');

	if (minesweeper.generated && cell.hovered && !cell.revealed) {
		if (!cell.flagged && input.isPressed('MouseLeft')) {
			cell.revealed = true;
			const exploded = revealCell(minesweeper.field, cell.row, cell.col);
			if (exploded) {
				minesweeper.done = true;
			}
			console.log(`Revealed cell at ${cell.row}:${cell.col}`);
		}
		if (input.isPressed('MouseRight')) {
			console.log(`Flagged cell at ${cell.row}:${cell.col}`);
			toggleCellFlag(minesweeper.field, cell.row, cell.col);
			cell.flagged = !cell.flagged;
		}
		return;
	}

	const value = minesweeper.field.data[cell.row][cell.col];
	if (minesweeper.generated && cell.hovered && cell.revealed && value > NONE && input.isPressed('MouseLeft')) {
		const exploded = chordeCell(minesweeper.field, cell.row, cell.col);
		if (exploded) {
			minesweeper.done = true;
		}
		return;
	}

	if (!minesweeper.generated && cell.hovered && !cell.revealed && input.isPressed('MouseLeft')) {
		console.log('Generating minefield...');
		minesweeper.generated = true;
		const index = indexOf(cell.row, cell.col, minesweeper.field.cols);
		minesweeper.field = generateMinefield(
			minesweeper.field.rows,
			minesweeper.field.cols,
			minesweeper.minesCount,
			index,
		);
		// TODO: Move this into a function.
		minesweeper.playerFlags = minesweeper.field.flags;
		revealCell(minesweeper.field, cell.row, cell.col);
		cell.revealed = true;
		minesweeper.solverFlags = minesweeper.field.flags.map((r) => r.slice());
		minesweeper.originalFlags = minesweeper.field.flags.map((r) => r.slice());
		minesweeper.solved = false;
	}
}

function drawCell(r: Renderer2d, config: GameConfig, minesweeper: Minesweeper, cell: CellInfo): void {
	let cellColor = Color.CELL;
	const value = minesweeper.field.data[cell.row][cell.col];
	if (cell.flagged) {
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
			r.drawText(text, textPosition, Color.TEXT);
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

main();

function initColors(): void {
	setColors(getComputedStyle(document.documentElement));
	if (import.meta.hot) {
		import.meta.hot.on('vite:afterUpdate', () => {
			console.log('Styles hot reloaded');
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
const Flags = {
	UNKNOWN: 0,
	FLAGGED: 1,
	REVEALED: 2,
} as const;

function generateMinefield(
	rows: number,
	cols: number,
	minesCount: number,
	targetIndex: number,
	rngSeed?: string,
): Minefield {
	const data = Array.from({ length: rows }, () => Array(cols).fill(0));
	rngSeed ??= Date.now().toString();
	placeMines(data, cols, targetIndex, minesCount, rngSeed);
	placeNumbers(data, cols);

	const flags = Array.from({ length: rows }, () => Array(cols).fill(Flags.UNKNOWN));
	return { rows, cols, data, flags };
}

function placeMines(data: number[][], cols: number, targetIndex: number, minesCount: number, rngSeed: string): void {
	const rows = data.length;
	const targetRow = rowOf(targetIndex, cols);
	const targetCol = colOf(targetIndex, cols);
	console.log(`Placing mines with seed: ${rngSeed} for [${rows}x${cols}] and target: [${targetRow};${targetCol}]`);
	const random = Random.fromSeed(rngSeed);
	const cellsCount = data.length * data[0].length;
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

function placeNumbers(data: number[][], cols: number): void {
	const rows = data.length;
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

function emptyMinefield(rows: number, cols: number): Minefield {
	return {
		rows,
		cols,
		data: Array.from({ length: rows }, () => Array(cols).fill(NONE)),
		flags: Array.from({ length: rows }, () => Array(cols).fill(Flags.UNKNOWN)),
	};
}

function revealCell(minefield: Minefield, row: number, col: number): boolean {
	if (!isInsideMinefield(minefield, row, col)) return false;
	if (minefield.flags[row][col] === Flags.FLAGGED) return false;
	if (minefield.flags[row][col] === Flags.REVEALED) return false;
	const value = minefield.data[row][col];
	minefield.flags[row][col] = Flags.REVEALED;
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
	if (flag === Flags.REVEALED) {
		console.warn(`[WARNING]: Trying to flag a revealed cell at (${row}:${col})`);
		return false;
	}
	if (flag === Flags.FLAGGED) {
		console.warn(`[WARNING]: Trying to flag an already flagged cell at (${row}:${col})`);
		return false;
	}
	minefield.flags[row][col] = Flags.FLAGGED;
	return true;
}

function unflagCell(minefield: Minefield, row: number, col: number): void {
	const flag = minefield.flags[row][col];
	if (flag === Flags.REVEALED) {
		console.warn(`[WARNING]: Trying to unflag a revealed cell at (${row}:${col})`);
		return;
	}
	if (flag === Flags.UNKNOWN) {
		console.warn(`[WARNING]: Trying to unflag an unknown cell at (${row}:${col})`);
		return;
	}
	minefield.flags[row][col] = Flags.UNKNOWN;
}

function toggleCellFlag(minefield: Minefield, row: number, col: number): void {
	if (minefield.flags[row][col] === Flags.FLAGGED) {
		unflagCell(minefield, row, col);
	} else {
		flagCell(minefield, row, col);
	}
}

/**
 * NOTE: When a number has the correct amount of flags, you can click on the number to open all the cells around it.
 * This is called a chord because in older versions it required pressing two buttons, left + right, at the same time.
 */
function chordeCell(minefield: Minefield, row: number, col: number): boolean {
	if (minefield.flags[row][col] !== Flags.REVEALED) return false;
	const value = minefield.data[row][col];
	if (value <= NONE) return false;

	let nearFlagsCount = 0;
	for (const [offsetRow, offsetCol] of OFFSETS) {
		const neighborRow = row + offsetRow;
		const neighborCol = col + offsetCol;
		if (minefield.flags?.[neighborRow]?.[neighborCol] === Flags.FLAGGED) {
			nearFlagsCount++;
		}
	}
	if (nearFlagsCount != value) return false;

	let anyExploded = false;
	for (const [offsetRow, offsetCol] of OFFSETS) {
		const neighborRow = row + offsetRow;
		const neighborCol = col + offsetCol;
		if (minefield.flags?.[neighborRow]?.[neighborCol] === Flags.UNKNOWN) {
			const exploded = revealCell(minefield, neighborRow, neighborCol);
			anyExploded ||= exploded;
		}
	}
	return anyExploded;
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

function getCellValueByIndex(minefield: Minefield, index: number): number | undefined {
	return getCellValue(minefield, rowOf(index, minefield.cols), colOf(index, minefield.cols));
}

function getCellFlag(minefield: Minefield, row: number, col: number): number | undefined {
	return minefield.flags?.[row]?.[col];
}

function getCellFlagByIndex(minefield: Minefield, index: number): number | undefined {
	return getCellFlag(minefield, rowOf(index, minefield.cols), colOf(index, minefield.cols));
}

function isCellFlagged(minefield: Minefield, index: number): boolean {
	return getCellFlagByIndex(minefield, index) === Flags.FLAGGED;
}

function isCellRevealed(minefield: Minefield, index: number): boolean {
	return getCellFlagByIndex(minefield, index) === Flags.REVEALED;
}

function isSolved(minefield: Minefield): boolean {
	for (let row = 0; row < minefield.rows; row++) {
		for (let col = 0; col < minefield.cols; col++) {
			const flag = getCellFlag(minefield, row, col);
			if (flag === Flags.UNKNOWN) return false;
		}
	}
	return true;
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
};

async function loadImages(): Promise<GameImages> {
	const flagImage = new Image();
	flagImage.src = './flag.png';
	const mineImage = new Image();
	mineImage.src = './mine.png';
	const mineExplodedImage = new Image();
	mineExplodedImage.src = './mine-exploded.png';
	await Promise.all([flagImage.decode(), mineImage.decode(), mineExplodedImage.decode()]);
	return {
		flag: flagImage,
		mine: mineImage,
		mineExploded: mineExplodedImage,
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

function trySolve(minesweeper: Minesweeper): boolean {
	console.log('[Solver] solving...');
	const { field: minefield, solverFlags } = minesweeper;
	const originalFlags = minesweeper.field.flags;
	minefield.flags = solverFlags;

	const solver: Solver = {
		minefield,
		minesCount: minesweeper.minesCount,
		constraints: [],
		todoConstraints: [],
		todoKnownCells: [],
	};
	for (const index of allIndices(minefield)) {
		if (isCellRevealed(minefield, index)) {
			solver.todoKnownCells.push(index);
		}
	}

	while (true) {
		let changed = false;

		while (solver.todoKnownCells.length > 0) {
			const index = solver.todoKnownCells.pop();
			if (index == null) throw new Error('[Solver] index must not be nullable');
			if (isCellRevealed(minefield, index)) {
				changed = solverAddConstraintByIndex(solver, index) || changed;
			}
			changed = solverReduceConstrainsMineCountForIndex(solver, index) > 0 || changed;
		}

		const constraint = solver.todoConstraints.pop();
		if (constraint != null) {
			if (constraint.minesCount === 0) {
				for (const index of constraint.cells) {
					changed = solverReveal(solver, index) || changed;
				}
			}
			if (constraint.minesCount === constraint.cells.size) {
				for (const index of constraint.cells) {
					changed = solverFlag(solver, index) || changed;
				}
			}
			for (const otherConstraint of solver.constraints) {
				if (otherConstraint === constraint) continue;
				changed = solverCompareConstraints(solver, constraint, otherConstraint) || changed;
				changed = solverCompareOverlapping(solver, constraint, otherConstraint) || changed;
			}
			continue;
		}

		if (!changed) {
			console.time('[Solver] tryGlobalMineCountDeduction');
			changed = solverTryGlobalMineCountDeduction(solver) || changed;
			console.timeEnd('[Solver] tryGlobalMineCountDeduction');
		}

		if (!changed) {
			break;
		}
	}
	minefield.flags = originalFlags;
	const solved = isSolved(minefield);
	if (solved) {
		console.log('[Solver] solved');
	} else {
		console.log('[Solver] failed to solve');
	}
	return solved;
}

// TODO: Turn this into a class and add functions as methods.
type Solver = {
	minefield: Minefield;
	minesCount: number;
	constraints: Constraint[];
	todoConstraints: Constraint[];
	todoKnownCells: number[];
};

type Constraint = {
	cells: Set<number>; // flattened field indices
	minesCount: number;
};

function solverAddConstraintByIndex(solver: Solver, index: number): boolean {
	const unknownNeighbors: Set<number> = new Set();
	const minefield = solver.minefield;
	const row = rowOf(index, minefield.cols);
	const col = colOf(index, minefield.cols);
	const value = getCellValue(minefield, row, col);
	if (value == null) {
		throw new Error(`Cell at index ${index} is out of bounds`);
	}
	let minesToFindCount = value;
	for (const neighborIndex of neighborIndices(minefield, index)) {
		const flag = getCellFlag(minefield, rowOf(neighborIndex, minefield.cols), colOf(neighborIndex, minefield.cols));
		if (flag === Flags.FLAGGED) {
			minesToFindCount -= 1;
		} else if (flag === Flags.UNKNOWN) {
			unknownNeighbors.add(neighborIndex);
		}
	}
	if (minesToFindCount < 0) {
		throw new Error(`Constraint is inconsistent: ${minesToFindCount} mines found, but only ${value} are allowed`);
	}
	if (unknownNeighbors.size > 0) {
		solverAddConstraint(solver, { cells: unknownNeighbors, minesCount: minesToFindCount });
		return true;
	}
	return false;
}

function solverAddConstraint(solver: Solver, constraint: Constraint): boolean {
	if (constraint.cells.size === 0) {
		if (constraint.minesCount !== 0) {
			throw new Error(`Constraint is inconsistent: ${constraint.minesCount} mines found, but only 0 are allowed`);
		}
		return false;
	}
	if (constraint.minesCount < 0 || constraint.minesCount > constraint.cells.size) {
		throw new Error(
			`Constraint is inconsistent: ${constraint.minesCount} mines found, but only 0-${constraint.cells.size} are allowed`,
		);
	}
	for (const existing of solver.constraints) {
		if (constraintEquals(existing, constraint)) {
			return false;
		}
	}
	solver.constraints.push(constraint);
	solver.todoConstraints.push(constraint);
	return true;
}

function constraintEquals(a: Constraint, b: Constraint): boolean {
	return a.minesCount === b.minesCount && a.cells.size === b.cells.size && a.cells.isSupersetOf(b.cells);
}

function solverReduceConstrainsMineCountForIndex(solver: Solver, index: number): number {
	let updatedCount = 0;
	const isMine = getCellValueByIndex(solver.minefield, index) === MINE;
	for (const constraint of solver.constraints) {
		if (!constraint.cells.has(index)) continue;
		constraint.cells.delete(index);
		if (isMine) {
			constraint.minesCount -= 1;
		}
		solver.todoConstraints.push(constraint);
	}
	return updatedCount;
}

function solverCompareConstraints(solver: Solver, a: Constraint, b: Constraint): boolean {
	if (a.cells.isSubsetOf(b.cells)) {
		const deltaCells = b.cells.difference(a.cells);
		const deltaMinesCount = b.minesCount - a.minesCount;
		solverAddConstraint(solver, { cells: deltaCells, minesCount: deltaMinesCount });
		return true;
	} else if (b.cells.isSubsetOf(a.cells)) {
		const deltaCells = a.cells.difference(b.cells);
		const deltaMinesCount = a.minesCount - b.minesCount;
		solverAddConstraint(solver, { cells: deltaCells, minesCount: deltaMinesCount });
		return true;
	}
	return false;
}

function solverCompareOverlapping(solver: Solver, a: Constraint, b: Constraint): boolean {
	const sharedCells = a.cells.intersection(b.cells);
	const aOnlyCells = a.cells.difference(sharedCells);
	const bOnlyCells = b.cells.difference(sharedCells);
	const deltaMinesCount = a.minesCount - b.minesCount;
	let changed = false;

	if (deltaMinesCount === aOnlyCells.size) {
		for (const index of aOnlyCells) {
			solverFlag(solver, index);
			changed = true;
		}
		for (const index of bOnlyCells) {
			solverReveal(solver, index);
			changed = true;
		}
	}
	if (-deltaMinesCount === bOnlyCells.size) {
		for (const index of aOnlyCells) {
			solverReveal(solver, index);
			changed = true;
		}
		for (const index of bOnlyCells) {
			solverFlag(solver, index);
			changed = true;
		}
	}
	return changed;
}

function solverTryGlobalMineCountDeduction(solver: Solver): boolean {
	let knownMines = 0;
	const unknownCells: number[] = [];

	for (const index of allIndices(solver.minefield)) {
		if (isCellFlagged(solver.minefield, index)) {
			knownMines++;
		} else if (!isCellRevealed(solver.minefield, index)) {
			unknownCells.push(index);
		}
	}

	const remainingMines = solver.minesCount - knownMines;
	const remainingSafe = unknownCells.length - remainingMines;

	if (remainingMines === 0) {
		for (const index of unknownCells) solverReveal(solver, index);
		return true;
	}

	if (remainingSafe === 0) {
		for (const index of unknownCells) solverFlag(solver, index);
		return true;
	}

	// TODO: Understand these.
	const mineConstraints = solverFindDisjointConstraintGroups(solver.constraints, remainingMines, (c) => c.minesCount);
	if (mineConstraints) {
		let changed = false;
		const coveredCells = getAllConstraintCells(mineConstraints);
		for (const index of unknownCells) {
			if (!coveredCells.has(index)) {
				solverReveal(solver, index);
				changed = true;
			}
		}

		return changed;
	}

	const safeConstraints = solverFindDisjointConstraintGroups(
		solver.constraints,
		remainingSafe,
		(c) => c.cells.size - c.minesCount,
	);
	if (safeConstraints) {
		let changed = false;
		const coveredCells = getAllConstraintCells(safeConstraints);
		for (const index of unknownCells) {
			if (!coveredCells.has(index)) {
				solverFlag(solver, index);
				changed = true;
			}
		}

		return changed;
	}

	return false;
}

function solverFindDisjointConstraintGroups(
	constraints: Constraint[],
	target: number,
	getValue: (constraint: Constraint) => number,
): Constraint[] | null {
	const group: Constraint[] = [];
	const usedCells = new Set<number>();

	function search(start: number, value: number): Constraint[] | null {
		if (value === target) {
			return group.slice();
		}

		if (value > target) {
			return null;
		}

		for (let i = start; i < constraints.length; i++) {
			const constraint = constraints[i];

			let overlaps = false;

			for (const cell of constraint.cells) {
				if (usedCells.has(cell)) {
					overlaps = true;
					break;
				}
			}

			if (overlaps) continue;

			const nextValue = value + getValue(constraint);

			// Important pruning
			if (nextValue > target) continue;

			group.push(constraint);
			for (const cell of constraint.cells) usedCells.add(cell);

			const result = search(i + 1, nextValue);
			if (result) return result;

			group.pop();
			for (const cell of constraint.cells) usedCells.delete(cell);
		}

		return null;
	}

	return search(0, 0);
}

function getAllConstraintCells(constraints: Constraint[]): Set<number> {
	const cells = new Set<number>();

	for (const constraint of constraints) {
		for (const cell of constraint.cells) {
			cells.add(cell);
		}
	}

	return cells;
}

function solverFlag(solver: Solver, index: number): boolean {
	const { minefield } = solver;
	if (isCellFlagged(minefield, index)) return false;
	const ok = flagCell(minefield, rowOf(index, minefield.cols), colOf(index, minefield.cols));
	if (ok) {
		solver.todoKnownCells.push(index);
	}
	return ok;
}

function solverReveal(solver: Solver, index: number): boolean {
	const { minefield } = solver;
	const row = rowOf(index, minefield.cols);
	const col = colOf(index, minefield.cols);
	if (!isInsideMinefield(minefield, row, col)) return false;
	if (minefield.flags[row][col] === Flags.FLAGGED) return false;
	if (minefield.flags[row][col] === Flags.REVEALED) return false;
	const value = minefield.data[row][col];
	minefield.flags[row][col] = Flags.REVEALED;
	if (value === MINE) return true;
	if (value === NONE) {
		for (const neighborIndex of neighborIndices(minefield, index)) {
			solverReveal(solver, neighborIndex);
		}
	}
	solver.todoKnownCells.push(index);
	return true;
}

function resetSolverFlags(minesweeper: Minesweeper): void {
	minesweeper.solverFlags = minesweeper.originalFlags.map((r) => r.slice());
}
