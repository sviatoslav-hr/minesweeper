import { isInsideRect, v2Clone, type Rect, type Vec2 } from '$math';
import { KeyboardInput } from './input';
import { random, type Random } from './random';
import { Renderer2d, type FontRendered } from './renderer';
import './style.css';

const Color = {
	BACKGROUND: '--color-bg',
	CELL: '--color-cell',
	CELL_HOVER: '--color-cell-hover',
	CELL_REVEALED: '--color-cell-revealed',
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
	minesCount: number;
	generated: boolean;
};

type Minefield = {
	rows: number;
	cols: number;
	data: number[][];
	flags: number[][];
};

const PADDING_WINDOW = 0.05;
const PADDING_CELL = 0.1;

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
	}

	const { flag: flagImage, mine: mineImage } = await loadImages();

	const r = new Renderer2d(context);
	r.resizeCanvas(window.innerWidth, window.innerHeight);

	window.addEventListener('resize', () => {
		r.resizeCanvas(window.innerWidth, window.innerHeight);
	});
	window.addEventListener('beforeunload', () => {
		if (minesweeper) {
			storage.setItem('minesweeper', JSON.stringify(minesweeper));
		}
	});

	const input = new KeyboardInput();
	input.listen(document.body, document.body);

	const cols = 30;
	const rows = 16;
	random.reset(String(Date.now()));

	const tick = () => {
		if (!globalThis.minesweeper) {
			console.log('[INFO]: Initializing minesweeper');
			globalThis.minesweeper = {
				field: emptyMinefield(rows, cols),
				minesCount: 0,
				generated: false,
			};
		}
		if (input.isPressed('KeyR')) {
			console.log('[INFO]: Resetting minesweeper');
			globalThis.minesweeper = {
				field: emptyMinefield(rows, cols),
				minesCount: 0,
				generated: false,
			};
		}
		const minesweeper = globalThis.minesweeper;
		const minefield = minesweeper.field;

		r.fillScreen(Color.BACKGROUND);

		const config = computeConfig(canvas, minesweeper, flagImage, mineImage);
		let isAnyHovered = false;

		r.setFont(config.font);
		r.context.textBaseline = config.textBaseline;
		r.context.textAlign = config.textAlign;

		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const cell = computeCell(config, minefield, col, row);
				isAnyHovered ||= cell.hovered;
				handleCellInput(minesweeper, input, cell);
				drawCell(r, input, config, minefield, cell);
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
	flagImage: HTMLImageElement;
	mineImage: HTMLImageElement;
};

function computeConfig(
	canvas: HTMLCanvasElement,
	minesweeper: Minesweeper,
	flagImage: HTMLImageElement,
	mineImage: HTMLImageElement,
): GameConfig {
	const { rows, cols } = minesweeper.field;
	const windowPadding =
		Math.min(canvas.width, canvas.height) * PADDING_WINDOW;
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
		flagImage,
		mineImage,
		font,
		textBaseline: 'middle',
		textAlign: 'center',
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
};

function computeCell(
	config: GameConfig,
	minefield: Minefield,
	col: number,
	row: number,
): CellInfo {
	const x =
		config.gridXOffset + col * config.cellSize + col * config.cellPadding;
	const y =
		config.gridYOffset + row * config.cellSize + row * config.cellPadding;
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
	const cell: CellInfo = {
		x,
		y,
		row,
		col,
		rect,
		center,
		hovered: false, // is computed in the handler
		flagged: flagged,
		revealed: revealed,
	};
	return cell;
}

function handleCellInput(
	minesweeper: Minesweeper,
	input: KeyboardInput,
	cell: CellInfo,
): void {
	cell.hovered = isInsideRect(input.getMousePosition(), cell.rect);

	if (cell.hovered && !cell.revealed && minesweeper.generated) {
		if (!cell.flagged && input.isPressed('MouseLeft')) {
			cell.revealed = true;
			revealCell(minesweeper.field, cell.row, cell.col);
			console.log(`Revealed cell at ${cell.row}:${cell.col}`);
		}
		if (input.isPressed('MouseRight')) {
			console.log(`Flagged cell at ${cell.row}:${cell.col}`);
			cell.flagged = !cell.flagged;
			minesweeper.field.flags[cell.row][cell.col] = cell.flagged
				? Flags.FLAGGED
				: Flags.UNFLAGGED;
		}
	}
	if (
		cell.hovered &&
		!cell.revealed &&
		!minesweeper.generated &&
		input.isPressed('MouseLeft')
	) {
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
		revealCell(minesweeper.field, cell.row, cell.col);
		cell.revealed = true;
	}
}

function drawCell(
	r: Renderer2d,
	input: KeyboardInput,
	config: GameConfig,
	minefield: Minefield,
	cell: CellInfo,
): void {
	let cellColor =
		cell.revealed || cell.flagged
			? Color.CELL_REVEALED
			: cell.hovered
				? Color.CELL_HOVER
				: Color.CELL;

	const value = minefield.data[cell.row][cell.col];
	const radius = 4;
	if (cell.revealed || input.isDown('Space')) {
		if (value === MINE) {
			r.drawRectRounded(cell.rect, radius, cellColor);
			r.drawImage(
				config.mineImage,
				cell.x,
				cell.y,
				config.cellSize,
				config.cellSize,
			);
		} else if (value > 0) {
			cellColor = numberToColor(value);
			r.drawRectRounded(cell.rect, radius, cellColor);
			const text = String(value);
			const textPosition = v2Clone(cell.center);
			const textMetrics = r.measureText(text);
			// NOTE: Often ascent and descent are not equal, so we need to center the text vertically.
			const ascentDiff =
				textMetrics.actualBoundingBoxAscent -
				textMetrics.actualBoundingBoxDescent;
			textPosition.y += ascentDiff / 2;
			r.drawText(text, textPosition, Color.TEXT);
		} else {
			r.drawRectRounded(cell.rect, radius, cellColor);
		}
	} else if (cell.flagged) {
		r.drawRectRounded(cell.rect, radius, cellColor);
		r.drawImage(
			config.flagImage,
			cell.x,
			cell.y,
			config.cellSize,
			config.cellSize,
		);
	} else {
		r.drawRectRounded(cell.rect, radius, cellColor);
	}
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
			const index = indexOf(
				targetRow + rowOffset,
				targetCol + colOffset,
				cols,
			);
			skipIndexes.push(index);
		}
	}
	for (let i = 0; i < minesCount; i++) {
		let attempts = 0;
		while (attempts < maxAttempts) {
			const tileIndex = random.int32Range(0, cellsCount);
			const tileRow = rowOf(tileIndex, cols);
			const tileCol = colOf(tileIndex, cols);
			if (
				data[tileRow][tileCol] === 0 &&
				!skipIndexes.includes(tileIndex)
			) {
				data[tileRow][tileCol] = MINE;
				break;
			}
			attempts++;
		}
		if (attempts === maxAttempts) {
			console.error(
				`Failed to place mine at ${i + 1} of ${minesCount}, skipping.`,
			);
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

	const flags = Array.from({ length: rows }, () => Array(cols));
	return { rows, cols, data, flags };
}

function emptyMinefield(rows: number, cols: number): Minefield {
	return {
		rows,
		cols,
		data: Array.from({ length: rows }, () => Array(cols).fill(NONE)),
		flags: Array.from({ length: rows }, () =>
			Array(cols).fill(Flags.UNFLAGGED),
		),
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
			if (
				neighborRow >= 0 &&
				neighborRow < minefield.rows &&
				neighborCol >= 0 &&
				neighborCol < minefield.cols
			) {
				revealCell(minefield, neighborRow, neighborCol);
			}
		}
	}
	return false;
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

async function loadImages(): Promise<{
	flag: HTMLImageElement;
	mine: HTMLImageElement;
}> {
	const flagImage = new Image();
	flagImage.src = './flag.png';
	const mineImage = new Image();
	mineImage.src = './mine.png';
	await Promise.all([flagImage.decode(), mineImage.decode()]);
	return { flag: flagImage, mine: mineImage };
}
