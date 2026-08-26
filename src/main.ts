import { isInsideRect, v2Clone, type Rect, type Vec2 } from '$math';
import { KeyboardInput } from './input';
import { random, type Random } from './random';
import { Renderer2d, type FontRendered } from './renderer';
import './style.css';

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
	data: number[][];
	flags: number[][];
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
	random.reset(String(Date.now()));

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

		const showSolverFlags = input.isDown('KeyS');
		minesweeper.field.flags = showSolverFlags ? minesweeper.solverFlags : minesweeper.playerFlags;

		if (input.isPressed('KeyE')) {
			trySolve(minesweeper);
		}
		if (input.isPressed('KeyQ')) {
			resetSolver(minesweeper);
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
			random,
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
	UNFLAGGED: 0,
	FLAGGED: 1,
	REVEALED: 2,
} as const;

function generateMinefield(
	random: Random,
	rows: number,
	cols: number,
	minesCount: number,
	targetIndex: number,
): Minefield {
	const data = Array.from({ length: rows }, () => Array(cols).fill(0));
	const cellsCount = rows * cols;
	const maxAttempts = 10;
	let skipIndexes: number[] = [targetIndex];
	{
		const targetRow = rowOf(targetIndex, cols);
		const targetCol = colOf(targetIndex, cols);
		for (const [rowOffset, colOffset] of OFFSETS) {
			const index = indexOf(targetRow + rowOffset, targetCol + colOffset, cols);
			skipIndexes.push(index);
		}
	}
	for (let i = 0; i < minesCount; i++) {
		let attempts = 0;
		while (attempts < maxAttempts) {
			const tileIndex = random.int32Range(0, cellsCount);
			const tileRow = rowOf(tileIndex, cols);
			const tileCol = colOf(tileIndex, cols);
			if (data[tileRow][tileCol] === 0 && !skipIndexes.includes(tileIndex)) {
				data[tileRow][tileCol] = MINE;
				break;
			}
			attempts++;
		}
		if (attempts === maxAttempts) {
			console.error(`Failed to place mine at ${i + 1} of ${minesCount}, skipping.`);
		}
	}

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

	const flags = Array.from({ length: rows }, () => Array(cols).fill(Flags.UNFLAGGED));
	return { rows, cols, data, flags };
}

function emptyMinefield(rows: number, cols: number): Minefield {
	return {
		rows,
		cols,
		data: Array.from({ length: rows }, () => Array(cols).fill(NONE)),
		flags: Array.from({ length: rows }, () => Array(cols).fill(Flags.UNFLAGGED)),
	};
}

function revealCell(minefield: Minefield, row: number, col: number): boolean {
	if (minefield.flags[row][col] === Flags.FLAGGED) return false;
	if (minefield.flags[row][col] === Flags.REVEALED) return false;
	const value = minefield.data[row][col];
	minefield.flags[row][col] = Flags.REVEALED;
	if (value === MINE) return true;
	if (value === NONE) {
		for (const [offsetRow, offsetCol] of OFFSETS) {
			const neighborRow = row + offsetRow;
			const neighborCol = col + offsetCol;
			if (isInsideMinefield(minefield, row, col)) {
				revealCell(minefield, neighborRow, neighborCol);
			}
		}
	}
	return false;
}

function flagCell(minefield: Minefield, row: number, col: number): void {
	const flag = minefield.flags[row][col];
	if (flag === Flags.REVEALED) {
		console.warn(`[WARNING]: Trying to flag a revealed cell at (${row}:${col})`);
		return;
	}
	if (flag === Flags.FLAGGED) {
		console.warn(`[WARNING]: Trying to flag an already flagged cell at (${row}:${col})`);
		return;
	}
	minefield.flags[row][col] = Flags.FLAGGED;
}

function unflagCell(minefield: Minefield, row: number, col: number): void {
	const flag = minefield.flags[row][col];
	if (flag === Flags.REVEALED) {
		console.warn(`[WARNING]: Trying to unflag a revealed cell at (${row}:${col})`);
		return;
	}
	if (flag === Flags.UNFLAGGED) {
		console.warn(`[WARNING]: Trying to unflag an unflagged cell at (${row}:${col})`);
		return;
	}
	minefield.flags[row][col] = Flags.UNFLAGGED;
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
		if (minefield.flags?.[neighborRow]?.[neighborCol] === Flags.UNFLAGGED) {
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

function getCellFlag(minefield: Minefield, row: number, col: number): number | undefined {
	return minefield.flags?.[row]?.[col];
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

type Solver = {
	maybeFlags: {
		maybeFlaggedFromIndex: Set<number>;
	}[][];
};

function trySolve(minesweeper: Minesweeper): boolean {
	console.log('[Solver] solving...');
	const { field: minefield, solverFlags } = minesweeper;
	const originalFlags = minesweeper.field.flags;
	minefield.flags = solverFlags;
	const solver: Solver = {
		maybeFlags: originalFlags.map((r) => r.map(() => ({ maybeFlaggedFromIndex: new Set() }))),
	};
	let changed = true;
	while (changed) {
		changed = false;
		const flaggedCount = solveFlagObiousCells(minefield);
		console.log(`[Solver] flagged ${flaggedCount} cells`);
		changed ||= flaggedCount > 0;
		const revealedCount = solveRevealObviousCells(minefield);
		console.log(`[Solver] revealed ${revealedCount} cells`);
		changed ||= revealedCount > 0;
		if (!changed) {
			const maybeFlaggedCount = solveMaybeFlagCells(minefield, solver);
			console.log(`[Solver] maybe flagged ${maybeFlaggedCount} cells`);
			changed ||= maybeFlaggedCount > 0;
			// TODO: If neighboring number covers a portion of this numbers unflagged neighbors and rest can be either fully flagged or fully revealed, then do that.
			// TODO: 8/5/3 that's fully block from rest of the numbers by a wall of mines. Same for two (and more) numbers together that are blocked off by mines.
			// TODO: Cells that can be deducted from the numbers of mines left to find.
		}
	}
	minefield.flags = originalFlags;
	return true;
}

function solveFlagObiousCells(minefield: Minefield): number {
	let flaggedCount = 0;
	for (let row = 0; row < minefield.rows; row++) {
		for (let col = 0; col < minefield.cols; col++) {
			const flag = getCellFlag(minefield, row, col);
			const revealed = flag === Flags.REVEALED;
			const value = getCellValue(minefield, row, col);
			if (revealed && value != null && value > 0) {
				const count = countCellNeighborsByFlags(minefield, row, col, Flags.FLAGGED, Flags.UNFLAGGED);
				if (count === value) {
					flaggedCount += flagAllUnflaggedNeighbors(minefield, row, col);
				}
			}
		}
	}
	return flaggedCount;
}

function solveRevealObviousCells(minefield: Minefield): number {
	let revealedCount = 0;
	for (let row = 0; row < minefield.rows; row++) {
		for (let col = 0; col < minefield.cols; col++) {
			const flag = getCellFlag(minefield, row, col);
			const value = getCellValue(minefield, row, col);
			if (flag === Flags.REVEALED && value != null && value > 0) {
				const counts = countCellAllNeighborsFlags(minefield, row, col);
				if (counts[Flags.FLAGGED] === value && counts[Flags.UNFLAGGED] > 0) {
					revealedCount += revealAllUnrevealedNeighbors(minefield, row, col);
				}
			}
		}
	}
	return revealedCount;
}

function solveMaybeFlagCells(minefield: Minefield, solver: Solver): number {
	for (let row = 0; row < minefield.rows; row++) {
		for (let col = 0; col < minefield.cols; col++) {
			solver.maybeFlags[row][col].maybeFlaggedFromIndex.clear();
		}
	}
	let flaggedCount = 0;
	for (let row = 0; row < minefield.rows; row++) {
		for (let col = 0; col < minefield.cols; col++) {
			const flag = getCellFlag(minefield, row, col);
			if (flag != Flags.REVEALED) continue;

			const value = getCellValue(minefield, row, col);
			if (value == null || value === 0) continue;

			const counts = countCellAllNeighborsFlags(minefield, row, col);
			if (counts[Flags.UNFLAGGED] <= 0) continue;

			const index = indexOf(row, col, minefield.cols);
			for (const [rowOffset, colOffset] of OFFSETS) {
				const neighborRow = row + rowOffset;
				const neighborCol = col + colOffset;
				const neighborFlag = getCellFlag(minefield, neighborRow, neighborCol);
				if (neighborFlag === Flags.UNFLAGGED) {
					const neighborFlaggedFrom = solver.maybeFlags[neighborRow][neighborCol].maybeFlaggedFromIndex;
					const size = neighborFlaggedFrom.size;
					neighborFlaggedFrom.add(index);
					if (neighborFlaggedFrom.size > size) {
						flaggedCount++;
					}
				}
			}
		}
	}
	return flaggedCount;
}

// function solveFlagCellsExceptMaybeFlagged(minefield: Minefield, solver: Solver): number {
// 	let flaggedCount = 0;
// 	for (let row = 0; row < minefield.rows; row++) {
// 		for (let col = 0; col < minefield.cols; col++) {
// 			const flag = getCellFlag(minefield, row, col);
// 			if (flag != Flags.REVEALED) continue;

// 			const value = getCellValue(minefield, row, col);
// 			if (value == null || value === 0) continue;

// 			const counts = countCellAllNeighborsFlags(minefield, row, col);
// 			if (counts[Flags.UNFLAGGED] <= 0) continue;

// 			// const index = indexOf(row, col, minefield.cols);
// 			for (const [rowOffset, colOffset] of OFFSETS) {
// 				const neighborRow = row + rowOffset;
// 				const neighborCol = col + colOffset;
// 				const neighborFlag = getCellFlag(minefield, neighborRow, neighborCol);
// 				if (neighborFlag === Flags.UNFLAGGED) {
// 					// TODO:
// 				}
// 			}
// 		}
// 	}
// 	return flaggedCount;
// }

function flagAllUnflaggedNeighbors(field: Minefield, row: number, col: number): number {
	let flaggedCount = 0;
	for (const [rowOffset, colOffset] of OFFSETS) {
		const neighborRow = row + rowOffset;
		const neighborCol = col + colOffset;
		const flag = getCellFlag(field, neighborRow, neighborCol);
		if (flag === Flags.UNFLAGGED) {
			flagCell(field, neighborRow, neighborCol);
			flaggedCount++;
		}
	}
	return flaggedCount;
}

function revealAllUnrevealedNeighbors(minefield: Minefield, row: number, col: number): number {
	let revealedCount = 0;
	for (const [rowOffset, colOffset] of OFFSETS) {
		const neighborRow = row + rowOffset;
		const neighborCol = col + colOffset;
		const flag = getCellFlag(minefield, neighborRow, neighborCol);
		if (flag === Flags.UNFLAGGED) {
			const exploded = revealCell(minefield, neighborRow, neighborCol);
			if (exploded) {
				console.error(`Exploded at (${neighborRow}:${neighborCol})`);
			} else {
				revealedCount++;
			}
		}
	}
	return revealedCount;
}

function countCellNeighborsByFlags(minefield: Minefield, row: number, col: number, ...flags: number[]): number {
	let count = 0;
	for (const [rowOffset, colOffset] of OFFSETS) {
		const neighborRow = row + rowOffset;
		const neighborCol = col + colOffset;
		const neighborFlag = getCellFlag(minefield, neighborRow, neighborCol);
		if (neighborFlag != null && flags.includes(neighborFlag)) {
			count++;
		}
	}
	return count;
}

function countCellAllNeighborsFlags(minefield: Minefield, row: number, col: number): Record<number, number> {
	const result: Record<number, number> = { [Flags.UNFLAGGED]: 0, [Flags.FLAGGED]: 0, [Flags.REVEALED]: 0 };
	for (const [rowOffset, colOffset] of OFFSETS) {
		const neighborFlag = getCellFlag(minefield, row + rowOffset, col + colOffset);
		if (neighborFlag != null) {
			result[neighborFlag] += 1;
		}
	}
	return result;
}

function resetSolver(minesweeper: Minesweeper): void {
	minesweeper.solverFlags = minesweeper.originalFlags.map((r) => r.slice());
}
