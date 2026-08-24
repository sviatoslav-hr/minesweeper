import { isInsideRect, v2Clone, type Rect } from '$math';
import { KeyboardInput } from './input';
import { random, type Random } from './random';
import { Renderer2d } from './renderer';
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
	generated: boolean;
};

type Minefield = {
	rows: number;
	cols: number;
	data: number[][];
	flags: number[][];
};

async function main(): Promise<void> {
	console.log('Game version 0.1');
	initColors();
	const appElement = document.getElementById('app');
	const storage: Storage = localStorage;

	if (!appElement) {
		console.error('App element not found');
		return;
	}

	const canvas = document.createElement('canvas');
	// Disable context menu from appearing on right-click
	canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
	appElement.appendChild(canvas);
	const context = canvas.getContext('2d');
	if (!context) {
		console.error('Canvas context not supported');
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
	const minesCount = 200;
	random.reset(String(Date.now()));

	const tick = () => {
		if (!globalThis.minesweeper) {
			console.log('Initializing minesweeper');
			globalThis.minesweeper = {
				field: emptyMinefield(rows, cols),
				generated: false,
			};
		}
		if (input.isPressed('KeyR')) {
			console.log('Resetting minesweeper');
			globalThis.minesweeper = {
				field: emptyMinefield(rows, cols),
				generated: false,
			};
		}
		const minesweeper = globalThis.minesweeper;
		const minefield = minesweeper.field;

		r.fillScreen(Color.BACKGROUND);
		const PADDING_WINDOW = 0.05;
		const PADDING_CELL = 0.1;
		const windowPadding =
			Math.min(canvas.width, canvas.height) * PADDING_WINDOW;
		const containerWidth = canvas.width - windowPadding * 2;
		const containerHeight = canvas.height - windowPadding * 2;
		const rawCellWidth = containerWidth / cols;
		const rawCellHeight = containerHeight / rows;
		const rawCellSize = Math.min(rawCellWidth, rawCellHeight);
		const cellPadding = rawCellSize * PADDING_CELL;
		const cellSizeX = (containerWidth - cellPadding * (cols - 1)) / cols;
		const cellSizeY = (containerHeight - cellPadding * (rows - 1)) / rows;
		const cellSize = Math.min(cellSizeX, cellSizeY);
		const gridWidth = cols * cellSize + (cols - 1) * cellPadding;
		const gridHeight = rows * cellSize + (rows - 1) * cellPadding;
		const gridXOffset = (canvas.width - gridWidth) / 2;
		const gridYOffset = (canvas.height - gridHeight) / 2;

		const mouse = input.getMousePosition();
		let isHoveringAny = false;

		const fontSize = cellSize * 0.8;
		r.setFont({ size: fontSize, weight: 700, family: 'Arial' });
		r.context.textBaseline = 'middle';
		r.context.textAlign = 'center';

		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const index = indexOf(row, col, cols);
				const x = gridXOffset + col * cellSize + col * cellPadding;
				const y = gridYOffset + row * cellSize + row * cellPadding;
				const rect: Rect = { x, y, width: cellSize, height: cellSize };
				const center = { x: x + cellSize / 2, y: y + cellSize / 2 };
				const isHovering = isInsideRect(mouse, rect);
				isHoveringAny ||= isHovering;
				let flagged =
					minesweeper.field.flags[row][col] === Flags.FLAGGED;
				let revealed =
					minesweeper.field.flags[row][col] === Flags.REVEALED;
				if (isHovering && !revealed && minesweeper.generated) {
					if (!flagged && input.isPressed('MouseLeft')) {
						revealed = true;
						revealCell(minefield, row, col);
						console.log(`Revealed cell at ${row}:${col}`);
					}
					if (input.isPressed('MouseRight')) {
						console.log(`Flagged cell at ${row}:${col}`);
						flagged = !flagged;
						minesweeper.field.flags[row][col] = flagged
							? Flags.FLAGGED
							: Flags.UNFLAGGED;
					}
				}
				if (
					isHovering &&
					!revealed &&
					!minesweeper.generated &&
					input.isPressed('MouseLeft')
				) {
					console.log('Generating minefield...');
					minesweeper.generated = true;
					minesweeper.field = generateMinefield(
						random,
						rows,
						cols,
						minesCount,
						index,
					);
					revealCell(minesweeper.field, row, col);
					revealed = true;
				}

				let cellColor =
					revealed || flagged
						? Color.CELL_REVEALED
						: isHovering
							? Color.CELL_HOVER
							: Color.CELL;

				// TODO: Rounded rect!
				const value = minefield.data[row][col];
				if (revealed || input.isDown('Space')) {
					if (value === MINE) {
						r.drawRect(rect, cellColor);
						r.drawImage(mineImage, x, y, cellSize, cellSize);
					} else if (value > 0) {
						cellColor = numberToColor(value);
						r.drawRect(rect, cellColor);
						const text = String(value);
						const textPosition = v2Clone(center);
						const textMetrics = r.measureText(text);
						const ascentDiff =
							textMetrics.actualBoundingBoxAscent -
							textMetrics.actualBoundingBoxDescent;
						// const heightDiff =
						// 	cellSize - textMetrics.actualBoundingBoxAscent;
						textPosition.y += ascentDiff / 2;
						r.drawText(text, textPosition, Color.TEXT);
					} else {
						r.drawRect(rect, cellColor);
					}
				} else if (flagged) {
					r.drawRect(rect, cellColor);
					r.drawImage(flagImage, x, y, cellSize, cellSize);
				} else {
					r.drawRect(rect, cellColor);
				}
			}
		}

		// PERF: Check if its fine to be constantly updating the style.
		if (isHoveringAny) {
			document.body.style.cursor = 'pointer';
		} else {
			document.body.style.cursor = 'default';
		}

		input.nextTick();
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
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
