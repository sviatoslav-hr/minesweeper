export const Color = {
	BACKGROUND: '--color-bg',
	CELL: '--color-cell',
	CELL_HOVER: '--color-cell-hover',
	CELL_EMPTY: '--color-cell-empty',
	CELL_MINE: '--color-cell-mine',
	CELL_WRONG: '--color-cell-wrong',
	CELL_EXPLODED: '--color-cell-exploded',
	FLAG: '--color-flag',
	FLAG_HANDLE: '--color-flag-handle',
	MINE_NORMAL: '--color-mine-normal',
	MINE_EXPLODED: '--color-mine-exploded',
	DIFFICULTY_ITEM_FG: '--color-difficulty-item-fg',
	DIFFICULTY_ITEM_BG: '--color-difficulty-item-bg',
	DIFFICULTY_ITEM_HOVER_FG: '--color-difficulty-item-hover-fg',
	DIFFICULTY_ITEM_HOVER_BG: '--color-difficulty-item-hover-bg',
	DIFFICULTY_ITEM_SELECTED_FG: '--color-difficulty-item-selected-fg',
	DIFFICULTY_ITEM_SELECTED_BG: '--color-difficulty-item-selected-bg',
	TIME_BG: '--color-time-bg',
	TIME_FG: '--color-time-fg',
	PAUSE_BG: '--color-pause-bg',
	PAUSE_FG: '--color-pause-fg',
	DIFFICULTY_BG: '--color-difficulty-bg',
	DIFFICULTY_FG: '--color-difficulty-fg',
	SMILEY_BG: '--color-smiley-bg',
	SMILEY_FG: '--color-smiley-fg',
	FLAG_BG: '--color-flag-bg',
	FLAG_FG: '--color-flag-fg',
	THEME_BG: '--color-theme-bg',
	THEME_FG: '--color-theme-fg',
	MINES_BG: '--color-mines-bg',
	MINES_FG: '--color-mines-fg',
	TEXT_OVERLAY: '--color-text-overlay',
	NUMBER1_BG: '--color-number-1-bg',
	NUMBER2_BG: '--color-number-2-bg',
	NUMBER3_BG: '--color-number-3-bg',
	NUMBER4_BG: '--color-number-4-bg',
	NUMBER5_BG: '--color-number-5-bg',
	NUMBER6_BG: '--color-number-6-bg',
	NUMBER7_BG: '--color-number-7-bg',
	NUMBER8_BG: '--color-number-8-bg',
	NUMBER1_FG: '--color-number-1-fg',
	NUMBER2_FG: '--color-number-2-fg',
	NUMBER3_FG: '--color-number-3-fg',
	NUMBER4_FG: '--color-number-4-fg',
	NUMBER5_FG: '--color-number-5-fg',
	NUMBER6_FG: '--color-number-6-fg',
	NUMBER7_FG: '--color-number-7-fg',
	NUMBER8_FG: '--color-number-8-fg',
};
const ColorVar = {
	...Color,
} as const;

type Theme = 'light' | 'dark';
const THEME_STORAGE_KEY = 'minesweeper-theme';

export function initColors(): void {
	let theme: Theme = 'light';
	try {
		if (localStorage.getItem(THEME_STORAGE_KEY) === 'dark') theme = 'dark';
	} catch (err) {
		console.warn('Failed to load theme preference', err);
	}
	applyTheme(theme);
	if (import.meta.hot) {
		import.meta.hot.on('vite:afterUpdate', () => {
			console.debug('Styles hot reloaded');
			reloadColors();
		});
	}
}

export function getTheme(): Theme {
	return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function toggleTheme(): void {
	const theme = getTheme() === 'light' ? 'dark' : 'light';
	applyTheme(theme);
	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch (err) {
		console.warn('Failed to save theme preference', err);
	}
}

function applyTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme;
	reloadColors();
}

function reloadColors(): void {
	const styles = getComputedStyle(document.documentElement);
	for (const [colorName, varName] of Object.entries(ColorVar)) {
		const colorValue = styles.getPropertyValue(varName).trim();
		if (colorValue) {
			Color[colorName as keyof typeof Color] = colorValue;
		} else {
			console.warn(`Color "${colorName}" not found for "${varName}"`);
		}
	}
}
