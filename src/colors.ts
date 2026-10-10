export const Color = {
	BACKGROUND: '--color-bg',
	CELL: '--color-cell',
	CELL_HOVER: '--color-cell-hover',
	CELL_EMPTY: '--color-cell-empty',
	CELL_WRONG: '--color-cell-wrong',
	CELL_EXPLODED: '--color-cell-exploded',
	DIFFICULTY_ITEM: '--color-difficulty-item',
	DIFFICULTY_HOVER: '--color-difficulty-hover',
	DIFFICULTY_SELECTED: '--color-difficulty-selected',
	TEXT: '--color-cell-text',
	TIME_BG: '--color-time-bg',
	MINES_BG: '--color-mines-bg',
	SMILEY_BG: '--color-smiley-bg',
	TEXT_TOPBAR: '--color-text-topbar',
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

export function initColors(): void {
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
