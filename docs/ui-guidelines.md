# UI guidelines

These guidelines explain the design choices to preserve as the game changes. The code is the source of truth for current behavior, sizes, defaults, and exact styling.

## Color and consistency

Use the numbered-cell palette for topbar blocks in left-to-right order, including readouts. Pause and the difficulty selector share green and stay adjacent. Keep each control's position and color stable across game states so players can find it without relearning the topbar.

Reuse the game's existing colors rather than adding unrelated accents. Color supports the icons and labels; it should not be the only way to understand an action. The palette lives in `src/style.css`.

## Keep the board central

The minefield is the main use of screen space. Fit controls into the topbar rather than adding permanent rows or shrinking the board for settings. Temporary panels may cover cells, but opening them should not move or resize the board.

Keep panels compact and visually close to their trigger. Use the same spacing, rounded shapes, and typography as the rest of the game. Keep labels readable and panels inside the viewport as the window changes size.

## Make actions clear

Keep setup, pause, reset, and flag mode as separate controls with consistent meanings. Do not hide routine actions in a combined button or dropdown. Use concise tooltips that describe what clicking will do and show a keyboard shortcut when one exists.

For settings, show the current selection clearly and apply choices directly rather than adding a separate save step. Keep unavailable choices visible but subdued, without suggesting they respond to hover. Explain why a choice is unavailable in its tooltip.

Opening or dismissing a picker must not reveal or flag cells. Closing it should not undo a choice. Keep player preferences separate from round progress so starting over does not unnecessarily reset them.

The difficulty selector currently changes grid size only. Describe what it actually changes rather than implying a difficulty system that is not implemented yet.

## Canvas UI

Keep game controls and panels in the canvas, with native tooltips rather than separate HTML controls or overlays. Click targets should match what players see, including after resizing or scaling. Layout and input handling live in `src/main.ts`.
