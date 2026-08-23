import { isInsideRect, scaleRectCentered, type Rect } from '$math';
import { KeyboardInput } from './input';
import { random, type Random } from './random';
import { Renderer2d } from './renderer';
import './style.css';

const Color = {
	BACKGROUND: '--color-bg',
	CELL: '--color-cell',
	CELL_HOVER: '--color-cell-hover',
	TEXT: '--color-text',
};

function main(): void {
	initColors();
	const appElement = document.getElementById('app');

	if (!appElement) {
		console.error('App element not found');
		return;
	}

	const canvas = document.createElement('canvas');
	appElement.appendChild(canvas);
	const context = canvas.getContext('2d');
	if (!context) {
		console.error('Canvas context not supported');
		return;
	}

	const r = new Renderer2d(context);
	r.resizeCanvas(window.innerWidth, window.innerHeight);
	r.context.textBaseline = 'middle';
	r.context.textAlign = 'center';

	window.addEventListener('resize', () => {
		r.resizeCanvas(window.innerWidth, window.innerHeight);
	});

	const input = new KeyboardInput();
	input.listen(appElement, document.body);

	const cols = 30;
	const rows = 16;
	const minesCount = 99;
	const minefield = generateMinefield(random, rows, cols, minesCount);

	let prevTime = 0;
	const tick = (time: number) => {
		const deltaTime = time - prevTime;
		prevTime = time;

		r.fillScreen(Color.TEXT);
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
		const mainFont = { size: fontSize, family: 'Arial' };
		r.setFont(mainFont);

		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const x = gridXOffset + col * cellSize + col * cellPadding;
				const y = gridYOffset + row * cellSize + row * cellPadding;
				const rect: Rect = { x, y, width: cellSize, height: cellSize };
				const center = { x: x + cellSize / 2, y: y + cellSize / 2 };
				const isHovering = isInsideRect(mouse, rect);
				isHoveringAny ||= isHovering;
				const color = isHovering ? Color.CELL_HOVER : Color.CELL;
				r.drawRect(rect, color);
				const hasMine = minefield.mines[row][col] === 1;
				if (hasMine) {
					r.drawRect(scaleRectCentered(rect, 0.8), 'blue');
				}
				const value = minefield.view[row][col];
				if (!hasMine && value > 0) {
					r.drawText(value.toString(), center, Color.TEXT);
				}
			}
		}

		// PERF: Check if its fine to be constantly updating the style.
		if (isHoveringAny) {
			document.body.style.cursor = 'pointer';
		} else {
			document.body.style.cursor = 'default';
		}

		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

main();

function initColors(): void {
	const rootStyles = getComputedStyle(document.documentElement);
	for (const [colorName, varName] of Object.entries(Color)) {
		const colorValue = rootStyles.getPropertyValue(varName);
		if (colorValue) {
			Color[colorName as keyof typeof Color] = colorValue;
		} else {
			console.warn(`Color "${colorName}" not found`);
		}
	}
}

type Minefield = {
	rows: number;
	cols: number;
	mines: number[][];
	view: number[][];
};
function generateMinefield(
	random: Random,
	rows: number,
	cols: number,
	minesCount: number,
): Minefield {
	const cells = Array.from({ length: rows }, () => Array(cols).fill(0));
	const cellsCount = rows * cols;
	for (let i = 0; i < minesCount; i++) {
		const mineIndex = random.int32Range(0, cellsCount);
		const mineRow = Math.floor(mineIndex / cols);
		const mineCol = mineIndex % cols;
		cells[mineRow][mineCol] = 1;
	}
	const view = Array.from({ length: rows }, () => Array(cols));
	// [N, NE, E, SE, S, SW, W, NW]
	const offsets = [
		[-1, 0],
		[-1, 1],
		[0, 1],
		[1, 1],
		[1, 0],
		[1, -1],
		[0, -1],
		[-1, -1],
	];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			let neighborMines = 0;
			for (const [rowOffset, colOffset] of offsets) {
				const neighborRow = row + rowOffset;
				const neighborCol = col + colOffset;
				if (
					neighborRow >= 0 &&
					neighborRow < rows &&
					neighborCol >= 0 &&
					neighborCol < cols &&
					cells[neighborRow][neighborCol] === 1
				) {
					neighborMines += 1;
				}
			}
			view[row][col] = neighborMines;
		}
	}
	return { rows, cols, mines: cells, view };
}
