import { isInsideRect, v2Clone, type Rect, type Vec2 } from '$math';
import { Color, initColors } from './colors';
import { KeyboardInput } from './input';
import { Random } from './random';
import { Renderer2d, type FontRendered } from './renderer';
import { SoundManager } from './sound';
import './style.css';

/*
TODO:
- Add a mute button (and key).
- Add a scoreboard.
- Allow optionally specifying the seed for minefield generation in the URL.
- Add a second "theme" where number color is displayed as text instead of a background.
- If screen is vertical, rotate the board.
- PERF: Change array to be index based instead of 2d array.
- TODO: Rename Flag to Mark and functions to markFlagged, etc
- Add a cool win animation.
- Add a cool lose animation (some kind of explosion?).
*/

declare global {
	var __MINESWEEPER_STATE: GameState;
}

// This object is not persisted and only exists in memory
type GameState = {
	minesweeper: Minesweeper;
	selectingDifficulty: boolean;
	canChangeDifficulty: boolean;
	canReset: boolean;
	hoveredDifficultyIndex: number; // -1 when none is hovered
	isAnyHovered: boolean;
	hoverButtonId: ButtonId | null;
	layout: GameLayout;
	renderer: Renderer2d;
	input: KeyboardInput;
	sounds: SoundManager;
	images: GameImages;
	debugReveal: boolean;
};

// This whole object is persisted
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
	paused: boolean;
	flagMode: boolean;
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
const DEFAULT_MINE_DENSITY = 0.25;
const DEV = new URL(location.href).hostname === 'localhost';

type GridSize = { rows: number; cols: number };

const gridSizes: GridSize[] = [
	{ rows: 8, cols: 15 },
	{ rows: 12, cols: 22 },
	{ rows: 16, cols: 30 },
];
const defaultGridSize = gridSizes[1];

async function main(): Promise<void> {
	console.log('[INFO]: Game version 0.1');
	initColors();
	const appElement = document.getElementById('app');
	if (!appElement) {
		console.error('[ERROR]: App element not found');
		return;
	}

	const renderer = createRenderer();
	if (!renderer) return;
	const canvas = renderer.context.canvas;
	appElement.appendChild(canvas);

	renderer.resizeCanvas(window.innerWidth, window.innerHeight);
	window.addEventListener('resize', () => {
		renderer.resizeCanvas(window.innerWidth, window.innerHeight);
	});

	const sounds = new SoundManager();
	renderer.context.canvas.addEventListener('mousedown', sounds.unlock);

	let savedMinesweeper = tryLoadPersistedGameState();
	savedMinesweeper ??= createMinesweeper(defaultGridSize.rows, defaultGridSize.cols);

	const input = new KeyboardInput();
	input.listen(document.body, renderer.context.canvas);

	const images = await loadImages();

	const state: GameState = {
		minesweeper: savedMinesweeper,
		selectingDifficulty: false,
		canChangeDifficulty: false,
		canReset: false,
		hoveredDifficultyIndex: -1,
		layout: recalculateLayout(canvas, savedMinesweeper.field, null),
		renderer: renderer,
		input: input,
		sounds: sounds,
		images: images,
		isAnyHovered: false,
		hoverButtonId: null,
		debugReveal: false,
	};
	globalThis.__MINESWEEPER_STATE = state;

	window.addEventListener('beforeunload', () => {
		persistMinesweeper(state.minesweeper);
	});

	startLoop(state);
}

function startLoop(state: GameState): void {
	let lastTime = performance.now();
	const tick = (time: number) => {
		const deltaTime = time - lastTime;
		lastTime = time;

		const { input, sounds, renderer } = state;
		const layout = (state.layout = recalculateLayout(state.renderer.canvas, state.minesweeper.field, state.layout));

		state.canChangeDifficulty = !isGameActive(state.minesweeper);
		state.canReset = state.minesweeper.generated;
		const wasSelectingDifficulty = state.selectingDifficulty;
		handleTopbarInput(state);
		let minesweeper = state.minesweeper;

		if (minesweeper.generated && !minesweeper.done && !minesweeper.paused) {
			minesweeper.time += deltaTime;
		}

		let isAnyHovered = state.hoverButtonId != null;

		renderer.fillScreen(Color.BACKGROUND);
		drawTopbar(state);

		renderer.setFont(layout.cellFont);
		renderer.context.textBaseline = layout.textBaseline;
		renderer.context.textAlign = layout.textAlign;

		for (let row = 0; row < minesweeper.field.rows; row++) {
			for (let col = 0; col < minesweeper.field.cols; col++) {
				try {
					const cell = computeCell(layout, minesweeper.field, row, col);
					if (
						!state.selectingDifficulty &&
						!wasSelectingDifficulty &&
						state.hoverButtonId === null &&
						!minesweeper.done &&
						!minesweeper.paused
					) {
						handleCellInput(minesweeper, input, cell, sounds);
					}
					if (minesweeper.paused) {
						drawPausedCell(renderer, cell);
					} else {
						drawCell(state, cell);
					}
					isAnyHovered ||= cell.hovered;
				} catch (e) {
					console.error(`[ERROR]: Failed to compute cell [${row};${col}]`, e);
				}
			}
		}

		if (!minesweeper.generated) {
			drawStartText(renderer, layout);
		} else if (minesweeper.paused) {
			drawPausedText(renderer, layout);
		}
		if (state.selectingDifficulty) {
			drawDifficultySelectionPanel(state);
		}

		// PERF: Check if its fine to be constantly updating the style.
		if (isAnyHovered) {
			renderer.canvas.style.cursor = 'pointer';
		} else {
			const difficultyDisallowed =
				state.selectingDifficulty && !state.canChangeDifficulty && state.hoverButtonId === 'difficulty-panel';
			renderer.canvas.style.cursor = difficultyDisallowed ? 'not-allowed' : 'default';
		}

		input.nextTick();
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

function createRenderer(): Renderer2d | null {
	const canvas = document.createElement('canvas');
	{
		canvas.setAttribute('role', 'img');
		canvas.setAttribute('aria-label', 'Minesweeper');
		// Disable context menu from appearing on right-click
		canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
	}
	const context = canvas.getContext('2d');
	if (!context) {
		console.error('[ERROR]: Canvas context not supported');
		return null;
	}
	const r = new Renderer2d(context);
	r.context.imageSmoothingEnabled = false;
	return r;
}

function isGameActive(game: Minesweeper): boolean {
	return game.generated && !game.done;
}

function tryLoadPersistedGameState(): Minesweeper | null {
	try {
		const savedMinesweeper = localStorage.getItem('minesweeper');
		if (savedMinesweeper) {
			const saved = JSON.parse(savedMinesweeper) as Minesweeper;
			if (!isPersistedGameStateValid(saved)) {
				throw new Error('Invalid Persisted game state');
			}
			saved.playerFlags = saved.field.flags;
			saved.paused = false;
			saved.flagMode ??= false; // Initialize for backwards compatibility when this field didn't exist.
			return saved;
		}
		return null;
	} catch (e) {
		console.warn('[WARNING]: Errored while loading persisted game state', e);
		return null;
	}
}

function createMinesweeper(rows: number, cols: number, flagMode = false): Minesweeper {
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
		paused: false,
		flagMode,
	};
}

function resetMinesweeper(state: GameState, size?: GridSize): Minesweeper {
	const flagMode = state.minesweeper.flagMode;
	size ??= state.minesweeper.field;
	state.minesweeper = createMinesweeper(size.rows, size.cols, flagMode);
	return state.minesweeper;
}

function isPersistedGameStateValid(game: Minesweeper): boolean {
	const field = game?.field;
	if (!field || !Number.isInteger(field.rows) || !Number.isInteger(field.cols) || field.rows <= 0 || field.cols <= 0)
		return false;
	const matrixMatches = (matrix: number[][]) =>
		Array.isArray(matrix) &&
		matrix.length === field.rows &&
		matrix.every((row) => Array.isArray(row) && row.length === field.cols && row.every(Number.isFinite));
	return (
		[field.data, field.flags, game.originalFlags, game.solverFlags].every(matrixMatches) &&
		Number.isFinite(game.time) &&
		Number.isFinite(game.expectedMinesCount) &&
		Number.isFinite(field.minesCount)
	);
}

function persistMinesweeper(game: Minesweeper): void {
	game.field.flags = game.playerFlags;
	try {
		localStorage.setItem('minesweeper', JSON.stringify(game));
	} catch (err) {
		console.error('Failed to persist minesweeper', err);
		// If a write fails, do not resurrect an obsolete round on the next reload.
		try {
			localStorage.removeItem('minesweeper');
		} catch (err) {
			/* Storage may be denied entirely. */
		}
	}
}

type TopbarLayout = Record<'time' | 'pause' | 'difficulty' | 'smiley' | 'flag' | 'mines', Rect>;
type ButtonId = 'pause' | 'difficulty-top' | 'smiley' | 'flag' | 'difficulty-panel';

type GameLayout = {
	layoutKey: string;
	cellSize: number;
	cellPadding: number;
	cellFont: FontRendered;
	gridWidth: number;
	gridHeight: number;
	gridXOffset: number;
	gridYOffset: number;
	startFont: FontRendered;
	topbarYOffset: number;
	topbarHeight: number;
	topbarGap: number;
	topbarPaddingX: number;
	topbarIconY: number;
	topbarIconSize: number;
	topbarFont: FontRendered;
	textBaseline: CanvasTextBaseline;
	textAlign: CanvasTextAlign;
	topbar: TopbarLayout;
	difficulty: DifficultyLayout;
};

function recalculateLayout(canvas: HTMLCanvasElement, size: GridSize, prevLayout: GameLayout | null): GameLayout {
	const layoutKey = makeLayoutKey(canvas, size);
	if (layoutKey === prevLayout?.layoutKey) return prevLayout;
	const layout = computeLayout(canvas, size);
	return layout;
}

function makeLayoutKey(canvas: HTMLCanvasElement, size: GridSize): string {
	return `${canvas.width}:${canvas.height}:${size.rows}:${size.cols}`;
}

function computeLayout(canvas: HTMLCanvasElement, size: GridSize): GameLayout {
	const { rows, cols } = size;
	const shortestCanvasSide = Math.min(canvas.width, canvas.height);
	const outerPadding = shortestCanvasSide * PADDING_CANVAS;

	const topbarHeight = shortestCanvasSide * TOPBAR_HEIGHT;
	const topbarGap = outerPadding;
	const topbarWidth = canvas.width - topbarGap * 2;
	const topbarXOffset = topbarGap;
	const topbarYOffset = topbarGap;
	const topbarPaddingX = topbarHeight * 0.1;
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

	const startFont: FontRendered = { size: gridHeight * 0.15, weight: 700, family: 'Arial' };
	const square = (x: number): Rect => ({ x, y: topbarYOffset, width: topbarHeight, height: topbarHeight });
	const smiley = square(gridXOffset + gridWidth / 2 - topbarHeight / 2);
	const difficulty = square(smiley.x - topbarHeight - topbarGap);
	const pause = square(difficulty.x - topbarHeight - topbarGap);
	const flag = square(smiley.x + topbarHeight + topbarGap);
	const minesX = flag.x + topbarHeight + topbarGap;
	const topbar: TopbarLayout = {
		smiley,
		difficulty,
		pause,
		flag,
		time: {
			x: topbarGap,
			y: topbarYOffset,
			width: Math.max(0, pause.x - topbarGap - topbarGap),
			height: topbarHeight,
		},
		mines: { x: minesX, y: topbarYOffset, width: topbarXOffset + topbarWidth - minesX, height: topbarHeight },
	};
	const difficultyLayout = computeDifficultyLayout(canvas, topbar.difficulty, topbarGap);
	const layoutKey = makeLayoutKey(canvas, size);

	return {
		layoutKey,
		cellSize,
		cellPadding,
		cellFont,
		gridWidth,
		gridHeight,
		gridXOffset,
		gridYOffset,
		topbarYOffset,
		topbarHeight,
		topbarGap,
		topbarPaddingX,
		topbarIconY,
		topbarIconSize,
		topbarFont,
		startFont,
		topbar,
		difficulty: difficultyLayout,
		textBaseline: 'middle',
		textAlign: 'center',
	};
}

type DifficultyLayout = {
	panel: Rect;
	choices: Rect[];
};

function computeDifficultyLayout(canvas: HTMLCanvasElement, anchor: Rect, gap: number): DifficultyLayout {
	const margin = gap;
	const padding = gap;
	const size = anchor.width * 1.5;
	// Top padding gives the first tile the same visible gap below the trigger.
	const desiredY = anchor.y + anchor.height;
	const width = gridSizes.length * size + (gridSizes.length - 1) * gap + padding * 2;
	const height = size + padding * 2;
	const x = Math.max(margin, Math.min(anchor.x + anchor.width / 2 - width / 2, canvas.width - width - margin));
	const y = Math.max(margin, Math.min(desiredY, canvas.height - height - margin));
	return {
		panel: { x, y, width, height },
		choices: gridSizes.map((_, index) => ({
			x: x + padding + index * (size + gap),
			y: y + padding,
			width: size,
			height: size,
		})),
	};
}

function findHoveredDifficultyIndex(layout: DifficultyLayout, mouse: Vec2): number {
	return layout.choices.findIndex((rect) => isInsideRect(mouse, rect));
}

function drawTopbarDifficultyButton(
	r: Renderer2d,
	props: {
		rect: Rect;
		selectingDifficulty: boolean;
	},
): void {
	r.drawRectRounded(props.rect, TOPBAR_RADIUS, Color.NUMBER2_BG);
	if (props.selectingDifficulty) {
		drawCrossIcon(r, props.rect, Color.TEXT);
	} else {
		drawCellsIcon(r, props.rect, Color.TEXT);
	}
}

function drawCrossIcon(r: Renderer2d, rect: Rect, color: string): void {
	const inset = rect.width * 0.28;
	const lineWidth = Math.max(1, rect.width * 0.065);
	r.drawLine(
		{ x: rect.x + inset, y: rect.y + inset },
		{ x: rect.x + rect.width - inset, y: rect.y + rect.height - inset },
		color,
		lineWidth,
	);
	r.drawLine(
		{ x: rect.x + inset, y: rect.y + rect.height - inset },
		{ x: rect.x + rect.width - inset, y: rect.y + inset },
		color,
		lineWidth,
	);
}

function drawCellsIcon(r: Renderer2d, rect: Rect, color: string): void {
	const side = Math.min(rect.width, rect.height);
	const x = rect.x + (rect.width - side) / 2 + side * 0.2;
	const y = rect.y + (rect.height - side) / 2 + side * 0.2;
	const size = side * 0.26;
	const step = side * 0.34;
	for (let row = 0; row < 2; row++)
		for (let col = 0; col < 2; col++) {
			r.drawRectRounded({ x: x + col * step, y: y + row * step, width: size, height: size }, side * 0.04, color);
		}
}

function drawDifficultySelectionPanel(state: GameState): void {
	const { renderer: r } = state;
	const { panel, choices } = state.layout.difficulty;
	const field = state.minesweeper.field;
	const context = r.context;
	const oldFont = r.font;
	context.save();
	context.globalAlpha *= state.canChangeDifficulty ? 1 : 0.7;
	r.drawRectRounded(panel, 4, Color.BACKGROUND);
	context.textBaseline = 'middle';
	context.textAlign = 'center';
	r.setFont({ size: (choices[0].height - 4) * 0.34, family: 'Arial', weight: 700 });
	for (const [index, choiceRect] of choices.entries()) {
		const size = gridSizes[index];
		const selected = size.rows === field.rows && size.cols === field.cols;
		let color = Color.DIFFICULTY_ITEM;
		if (selected) color = Color.DIFFICULTY_SELECTED;
		else if (state.canChangeDifficulty && state.hoveredDifficultyIndex === index) color = Color.DIFFICULTY_HOVER;
		r.drawRectRounded(choiceRect, 4, color);
		const text = `${size.cols}×${size.rows}`;
		const metrics = r.measureText(text);
		r.drawText(
			text,
			{
				x: choiceRect.x + choiceRect.width / 2,
				y:
					choiceRect.y +
					choiceRect.height / 2 +
					(metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2,
			},
			Color.TEXT,
		);
	}
	context.restore();
	r.setFont(oldFont);
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

function computeCell(config: GameLayout, minefield: Minefield, row: number, col: number): CellInfo {
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
	const revealPressed = input.isPressed(minesweeper.flagMode ? 'MouseRight' : 'MouseLeft');
	const flagPressed = input.isPressed(minesweeper.flagMode ? 'MouseLeft' : 'MouseRight');

	if (minesweeper.generated && cell.hovered && !cell.revealed) {
		if (!cell.flagged && revealPressed) {
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
		if (flagPressed) {
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

function drawStartText(r: Renderer2d, config: GameLayout) {
	r.setFont(config.startFont);
	const text = 'CLICK TO START';
	let m = r.measureText(text);
	let textY = config.gridYOffset + config.gridHeight / 2;
	let x = config.gridXOffset + config.gridWidth / 2;
	const ascentDiff = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent;
	textY += ascentDiff / 2;
	r.context.globalAlpha = 0.5;
	r.drawText(text, { x, y: textY }, Color.TEXT_TOPBAR);
	r.context.globalAlpha = 1;
}

function drawPausedText(r: Renderer2d, config: GameLayout): void {
	r.setFont(config.startFont);
	const text = 'PAUSED';
	const metrics = r.measureText(text);
	const position = {
		x: config.gridXOffset + config.gridWidth / 2,
		y: config.gridYOffset + config.gridHeight / 2,
	};
	position.y += (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
	r.context.globalAlpha = 0.5;
	r.drawText(text, position, Color.TEXT_TOPBAR);
	r.context.globalAlpha = 1;
}

function handleTopbarInput(state: GameState): void {
	const { input, layout, sounds } = state;
	let minesweeper = state.minesweeper;
	const mouse = input.getMousePosition();
	const leftMousePressed = input.isPressed('MouseLeft');

	let tooltip = '';
	state.hoverButtonId = null;
	state.hoveredDifficultyIndex = -1;

	if (state.selectingDifficulty) {
		if (input.isPressed('Escape')) {
			state.selectingDifficulty = false;
		} else {
			if (isInsideRect(mouse, layout.difficulty.panel)) {
				const index = findHoveredDifficultyIndex(layout.difficulty, mouse);
				if (index > -1) {
					tooltip = state.canChangeDifficulty
						? 'Change grid size'
						: 'Finish or reset the game to change grid size';
				}
				if (index > -1 && state.canChangeDifficulty) {
					state.hoverButtonId = 'difficulty-panel';
					state.hoveredDifficultyIndex = index;
					if (leftMousePressed) {
						minesweeper = resetMinesweeper(state, gridSizes[index]);
						state.selectingDifficulty = false;
					}
				}
			} else if (isInsideRect(mouse, layout.topbar.difficulty)) {
				state.hoverButtonId = 'difficulty-top';
				tooltip = state.selectingDifficulty ? 'Close (Esc)' : 'Choose grid size';
				if (leftMousePressed) {
					void sounds.play('click');
					state.selectingDifficulty = false;
				}
			} else if (leftMousePressed) {
				// NOTE: Any outside click should lead to closing the difficulty panel.
				//       We don't consume this click and allow a topbar button to be clicked at the same time.
				state.selectingDifficulty = false;
			}
		}
	} else {
		if (isInsideRect(mouse, layout.topbar.difficulty)) {
			state.hoverButtonId = 'difficulty-top';
			if (leftMousePressed) {
				void sounds.play('click');
				state.selectingDifficulty = true;
			}
			tooltip = state.selectingDifficulty ? 'Close (Esc)' : 'Choose grid size';
		}
	}
	if (state.hoverButtonId === 'difficulty-top' && !state.selectingDifficulty && !state.canChangeDifficulty) {
		tooltip = 'View grid sizes';
	}

	if (state.canReset) {
		let smileyClicked = false;
		if (isInsideRect(mouse, layout.topbar.smiley)) {
			state.hoverButtonId = 'smiley';
			tooltip = 'Reset game (R)';
			if (leftMousePressed) {
				void sounds.play('click');
				smileyClicked = true;
			}
		}
		if (smileyClicked || input.isPressed('KeyR')) {
			minesweeper = resetMinesweeper(state);
		}
	}

	if (isGameActive(minesweeper)) {
		let pauseClicked = false;
		if (isInsideRect(mouse, layout.topbar.pause)) {
			state.hoverButtonId = 'pause';
			if (leftMousePressed) {
				void sounds.play('click');
				pauseClicked = true;
			}
		}
		if (pauseClicked || input.isPressed('KeyP')) {
			minesweeper.paused = !minesweeper.paused;
		}
		if (state.hoverButtonId === 'pause') {
			tooltip = minesweeper.paused ? 'Resume (P)' : 'Pause (P)';
		}

		let flagClicked = false;
		if (isInsideRect(mouse, layout.topbar.flag)) {
			state.hoverButtonId = 'flag';
			if (leftMousePressed) {
				void sounds.play('click');
				flagClicked = true;
			}
		}
		if (flagClicked || input.isPressed('KeyF')) {
			minesweeper.flagMode = !minesweeper.flagMode;
		}
		if (state.hoverButtonId === 'flag') {
			tooltip = minesweeper.flagMode ? 'Switch to reveal mode (F)' : 'Switch to flag mode (F)';
		}
	}

	state.renderer.canvas.title = tooltip;
	state.debugReveal = DEV && !state.selectingDifficulty && input.isDown('Space');
}

function drawTopbar(state: GameState) {
	const { renderer: r, layout, minesweeper, images } = state;
	r.context.textBaseline = layout.textBaseline;
	r.context.textAlign = layout.textAlign;
	r.setFont(layout.topbarFont);

	drawTopbarClockSection(r, {
		minesweeper: minesweeper,
		config: layout,
		images: state.images,
		rect: layout.topbar.time,
	});
	drawTopbarPauseButton(r, {
		rect: layout.topbar.pause,
		paused: minesweeper.paused,
		showIcon: isGameActive(minesweeper),
	});
	drawTopbarDifficultyButton(r, {
		rect: layout.topbar.difficulty,
		selectingDifficulty: state.selectingDifficulty,
	});
	drawTopbarSmileyButton(r, {
		rect: layout.topbar.smiley,
		config: layout,
		minesweeper,
		images,
	});
	drawTopbarFlagModeButton(r, {
		rect: layout.topbar.flag,
		images: images,
		isFlagMode: minesweeper.flagMode,
		showIcon: isGameActive(minesweeper),
	});
	drawTopbarMinesSection(r, {
		config: layout,
		images,
		minesweeper,
		rect: layout.topbar.mines,
	});
}

function drawTopbarClockSection(
	r: Renderer2d,
	options: {
		rect: Rect;
		minesweeper: Minesweeper;
		config: GameLayout;
		images: GameImages;
	},
) {
	const { rect, minesweeper, config, images } = options;
	const time = minesweeper.generated ? minesweeper.time : 0;
	const topbarYCenter = config.topbarYOffset + config.topbarHeight / 2;
	r.drawRectRounded(rect, TOPBAR_RADIUS, Color.TIME_BG);

	if (time > 0) {
		r.context.save();
		r.context.beginPath();
		r.context.rect(rect.x, rect.y, rect.width, rect.height);
		r.context.clip();
		const iconX = config.topbar.time.x + config.topbarPaddingX;
		const iconY = rect.y + rect.height / 2 - config.topbarIconSize / 2;
		r.drawImage(images.clock, iconX, iconY, config.topbarIconSize, config.topbarIconSize);

		const text = timeToHumanString(time);
		const textMetrics = r.measureText(text);
		const textX = iconX + config.topbarIconSize + config.topbarPaddingX + textMetrics.width / 2;
		const ascentDiff = textMetrics.actualBoundingBoxAscent - textMetrics.actualBoundingBoxDescent;
		const textY = topbarYCenter + ascentDiff / 2;
		r.drawText(text, { x: textX, y: textY }, Color.TEXT_TOPBAR);
		r.context.restore();
	}
}

function drawTopbarPauseButton(
	r: Renderer2d,
	props: {
		rect: Rect;
		paused: boolean;
		showIcon: boolean;
	},
): void {
	const { rect, paused, showIcon } = props;
	r.drawRectRounded(rect, TOPBAR_RADIUS, Color.NUMBER2_BG);
	if (!showIcon) return;

	if (paused) {
		drawResumeIcon(r, rect, Color.TEXT);
	} else {
		drawPauseIcon(r, rect, Color.TEXT);
	}
}

function drawResumeIcon(r: Renderer2d, rect: Rect, color: string): void {
	r.context.fillStyle = color;
	r.context.beginPath();
	r.context.moveTo(rect.x + rect.width * 0.39, rect.y + rect.height * 0.27);
	r.context.lineTo(rect.x + rect.width * 0.73, rect.y + rect.height * 0.5);
	r.context.lineTo(rect.x + rect.width * 0.39, rect.y + rect.height * 0.73);
	r.context.closePath();
	r.context.fill();
}

function drawPauseIcon(r: Renderer2d, rect: Rect, color: string): void {
	const barWidth = rect.width * 0.13;
	const barHeight = rect.height * 0.48;
	const barY = rect.y + (rect.height - barHeight) / 2;
	r.drawRect(rect.x + rect.width * 0.32, barY, barWidth, barHeight, color);
	r.drawRect(rect.x + rect.width * 0.55, barY, barWidth, barHeight, color);
}

function drawTopbarSmileyButton(
	r: Renderer2d,
	options: {
		rect: Rect;
		config: GameLayout;
		minesweeper: Minesweeper;
		images: GameImages;
	},
): void {
	const { rect, config, minesweeper, images } = options;
	let image: HTMLImageElement | undefined;
	if (minesweeper.generated && minesweeper.done) {
		image = minesweeper.failed ? images.smileyDead : images.smileyCool;
	} else {
		image = images.smiley;
	}
	r.drawRectRounded(rect, TOPBAR_RADIUS, Color.SMILEY_BG);
	const paddingX = (rect.width - config.topbarIconSize) / 2;
	const paddingY = (rect.height - config.topbarIconSize) / 2;
	const smileyIconRect: Rect = {
		x: rect.x + paddingX,
		y: rect.y + paddingY,
		width: config.topbarIconSize,
		height: config.topbarIconSize,
	};
	r.drawImage(image, smileyIconRect.x, smileyIconRect.y, smileyIconRect.width, smileyIconRect.height);
}

function drawTopbarFlagModeButton(
	r: Renderer2d,
	options: {
		rect: Rect;
		images: GameImages;
		isFlagMode: boolean;
		showIcon: boolean;
	},
): void {
	const { rect, images, isFlagMode, showIcon } = options;
	r.drawRectRounded(rect, TOPBAR_RADIUS, Color.NUMBER4_BG);
	if (!showIcon) return;

	const iconSize = rect.height * 0.78;
	const image = isFlagMode ? images.flag : images.mine;
	r.drawImage(image, rect.x + (rect.width - iconSize) / 2, rect.y + (rect.height - iconSize) / 2, iconSize, iconSize);
}

function drawTopbarMinesSection(
	r: Renderer2d,
	options: {
		rect: Rect;
		config: GameLayout;
		images: GameImages;
		minesweeper: Minesweeper;
	},
): void {
	const { rect, config, images, minesweeper } = options;
	r.drawRectRounded(rect, TOPBAR_RADIUS, Color.MINES_BG);
	if (!minesweeper.generated) return;

	const rightX = rect.x + rect.width;
	const imageX = rightX - config.topbarIconSize - config.topbarPaddingX;
	const imageY = rect.y + (rect.height - config.topbarIconSize) / 2;
	r.drawImage(images.mine, imageX, imageY, config.topbarIconSize, config.topbarIconSize);

	const minesRemaining = Math.max(0, minesweeper.field.minesCount - countFlags(minesweeper.field));
	const text = minesRemaining.toString().padStart(3, '0');
	const textMetrics = r.measureText(text);
	const ascentDiff = textMetrics.actualBoundingBoxAscent - textMetrics.actualBoundingBoxDescent;
	const textY = rect.y + rect.height / 2 + ascentDiff / 2;
	const textX = imageX - config.topbarPaddingX - textMetrics.width / 2;
	r.drawText(text, { x: textX, y: textY }, Color.TEXT_TOPBAR);
}

function drawPausedCell(r: Renderer2d, cell: CellInfo): void {
	r.drawRectRounded(cell.rect, CELL_RADIUS, Color.CELL_EMPTY);
}

function drawCell(state: GameState, cell: CellInfo): void {
	const { minesweeper, layout, renderer: r, images, debugReveal } = state;
	let cellColor = Color.CELL;
	const value = minesweeper.field.data[cell.row][cell.col];
	if (cell.flagged && !debugReveal) {
		if (cell.hovered) {
			cellColor = Color.CELL_HOVER;
		}
		if ((minesweeper.done || debugReveal) && value !== MINE) {
			cellColor = Color.CELL_WRONG;
		}
		r.drawRectRounded(cell.rect, CELL_RADIUS, cellColor);
		r.drawImage(state.images.flag, cell.x, cell.y, layout.cellSize, layout.cellSize);
	} else if (value === MINE && (minesweeper.done || debugReveal || cell.hinted)) {
		if (cell.revealed) {
			cellColor = Color.CELL_EXPLODED;
		} else {
			cellColor = Color.CELL_EMPTY;
		}
		r.drawRectRounded(cell.rect, CELL_RADIUS, cellColor);
		const image = minesweeper.done && cell.revealed ? images.mineExploded : images.mine;
		r.drawImage(image, cell.x, cell.y, layout.cellSize, layout.cellSize);
	} else if (cell.revealed || debugReveal || cell.hinted) {
		if (value === NONE) {
			r.drawRectRounded(cell.rect, CELL_RADIUS, Color.CELL_EMPTY);
		} else {
			cellColor = numberToBackgroundColor(value);
			r.drawRectRounded(cell.rect, CELL_RADIUS, cellColor);
			const text = String(value);
			const textPosition = v2Clone(cell.center);
			const textMetrics = r.measureText(text);
			// NOTE: Often ascent and descent are not equal, so we need to center the text vertically.
			const ascentDiff = textMetrics.actualBoundingBoxAscent - textMetrics.actualBoundingBoxDescent;
			textPosition.y += ascentDiff / 2;
			const textColor = numberToForegroundColor(value);
			r.drawText(text, textPosition, textColor);
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
			shuffleUnknownCells(minefield, random, minesweeper.solverFlags);
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

function shuffleUnknownCells(minefield: Minefield, random: Random, solverFlags: number[][]): void {
	const cols = minefield.cols;
	const unknownIndices: number[] = [];
	for (let index of allIndices(minefield)) {
		const row = rowOf(index, cols);
		const col = colOf(index, cols);
		const flag = solverFlags[row]?.[col];
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
		solverFlags[rowI][colI] = Flag.UNKNOWN;
		solverFlags[rowJ][colJ] = Flag.UNKNOWN;
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

function numberToBackgroundColor(number: number): string {
	switch (number) {
		case 1:
			return Color.NUMBER1_BG;
		case 2:
			return Color.NUMBER2_BG;
		case 3:
			return Color.NUMBER3_BG;
		case 4:
			return Color.NUMBER4_BG;
		case 5:
			return Color.NUMBER5_BG;
		case 6:
			return Color.NUMBER6_BG;
		case 7:
			return Color.NUMBER7_BG;
		case 8:
			return Color.NUMBER8_BG;
		default:
			return Color.NUMBER1_BG;
	}
}

function numberToForegroundColor(number: number): string {
	switch (number) {
		case 1:
			return Color.NUMBER1_FG;
		case 2:
			return Color.NUMBER2_FG;
		case 3:
			return Color.NUMBER3_FG;
		case 4:
			return Color.NUMBER4_FG;
		case 5:
			return Color.NUMBER5_FG;
		case 6:
			return Color.NUMBER6_FG;
		case 7:
			return Color.NUMBER7_FG;
		case 8:
			return Color.NUMBER8_FG;
		default:
			return Color.NUMBER1_FG;
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
	const seconds = Math.ceil(time / 1000); // NOTE: ceil not avoid showing 0 seconds.
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes === 0) return `${remainingSeconds}s`;
	return `${minutes}m ${remainingSeconds}s`;
}

main();
