// PERF: It might not be the very efficient to use string every time to check

import { v2Clone, v2SetFrom, v2Sub, type Vec2 } from '$math';

// if the button is pressed. Could be better to use a number even a number flag.
export type KeyCode =
	| 'KeyA'
	| 'KeyB'
	| 'KeyC'
	| 'KeyD'
	| 'KeyD'
	| 'KeyE'
	| 'KeyF'
	| 'KeyG'
	| 'KeyH'
	| 'KeyI'
	| 'KeyJ'
	| 'KeyK'
	| 'KeyL'
	| 'KeyM'
	| 'KeyN'
	| 'KeyO'
	| 'KeyP'
	| 'KeyQ'
	| 'KeyR'
	| 'KeyS'
	| 'KeyT'
	| 'KeyU'
	| 'KeyV'
	| 'KeyW'
	| 'KeyX'
	| 'KeyY'
	| 'KeyZ'
	| 'Digit1'
	| 'Digit2'
	| 'Digit3'
	| 'Digit4'
	| 'Digit5'
	| 'Digit6'
	| 'Digit7'
	| 'Digit8'
	| 'Digit9'
	| 'Digit0'
	| 'Minus'
	| 'Equal'
	| 'Escape'
	| 'Space'
	| 'Backquote'
	| 'Semicolon'
	| 'Quote'
	| 'BracketLeft'
	| 'BracketRight'
	| 'Backslash'
	| 'Slash'
	| 'ShiftLeft'
	| 'ShiftRight'
	| 'ControlLeft'
	| 'ControlRight'
	| 'AltLeft'
	| 'AltRight'
	| 'MetaLeft'
	| 'ArrowLeft'
	| 'ArrowRight'
	| 'ArrowUp'
	| 'ArrowDown'
	| 'MouseLeft'
	| 'MouseMiddle'
	| 'MouseRight'
	| 'Mouse4'
	| 'Mouse5';

export type KeysState = Partial<Record<KeyCode, boolean>>;
export type KeyHandler = (event: Event, code: KeyCode) => void;

export interface MouseState {
	currentPosition: Vec2;
	previousPosition: Vec2;
	currentWheenDelta: number;
	previousWheelDelta: number;
}

export class KeyboardInput {
	private currentPressed: KeysState = {};
	private previousPressed: KeysState = {};
	private pressesThisTick = new Set<KeyCode>();
	private mouse: MouseState = {
		currentPosition: { x: 0, y: 0 },
		previousPosition: { x: 0, y: 0 },
		currentWheenDelta: 0,
		previousWheelDelta: 0,
	};

	isPressed(code: KeyCode): boolean {
		return this.pressesThisTick.has(code);
	}

	isDown(code: KeyCode): boolean {
		return !!this.currentPressed[code];
	}

	isReleased(code: KeyCode): boolean {
		return !!this.previousPressed[code] && !this.currentPressed[code];
	}

	isUp(code: KeyCode): boolean {
		return !this.currentPressed[code];
	}

	getMouseX(): number {
		return this.mouse.currentPosition.x;
	}

	getMouseY(): number {
		return this.mouse.currentPosition.y;
	}

	getMousePosition(): Vec2 {
		// WARN: This shouldn't be modified outside of the input class
		return this.mouse.currentPosition;
	}

	getMouseDelta(): Vec2 {
		return v2Sub(v2Clone(this.mouse.previousPosition), this.mouse.currentPosition);
	}

	getMouseWheelDelta(): number {
		return this.mouse.currentWheenDelta;
	}

	readonly handleKeyDown = (ev: KeyboardEvent) => {
		const code = ev.code as KeyCode;
		this.setPressed(code);
	};
	readonly handleKeyUp = (ev: KeyboardEvent) => {
		const code = ev.code as KeyCode;
		this.setReleased(code);
	};
	readonly handleMouseDown = (ev: MouseEvent) => {
		const code = mouseKeyCode(ev.button);
		if (code != null) this.setPressed(code);
	};
	readonly handleMouseUp = (ev: MouseEvent) => {
		const code = mouseKeyCode(ev.button);
		if (code != null) this.setReleased(code);
	};
	readonly handleMouseMove = (ev: MouseEvent, canvas: HTMLCanvasElement) => {
		const rect = canvas.getBoundingClientRect();
		this.mouse.currentPosition.x = ((ev.clientX - rect.left) * canvas.width) / rect.width;
		this.mouse.currentPosition.y = ((ev.clientY - rect.top) * canvas.height) / rect.height;
	};
	readonly handleWheel = (ev: WheelEvent) => {
		this.mouse.currentWheenDelta = ev.deltaY;
	};

	listen(element: HTMLElement, canvas: HTMLCanvasElement) {
		element.addEventListener('keydown', this.handleKeyDown);
		element.addEventListener('keyup', this.handleKeyUp);
		element.addEventListener('mousedown', (ev) => {
			this.handleMouseMove(ev, canvas);
			this.handleMouseDown(ev);
		});
		element.addEventListener('mouseup', this.handleMouseUp);
		element.addEventListener('mousemove', (ev) => this.handleMouseMove(ev, canvas));
		element.addEventListener('wheel', this.handleWheel);
	}

	nextTick() {
		this.previousPressed = { ...this.currentPressed };
		this.pressesThisTick.clear();
		v2SetFrom(this.mouse.previousPosition, this.mouse.currentPosition);
		this.mouse.previousWheelDelta = this.mouse.currentWheenDelta;
		this.mouse.currentWheenDelta = 0;
	}

	private setPressed(code: KeyCode) {
		if (!this.currentPressed[code]) this.pressesThisTick.add(code);
		this.currentPressed[code] = true;
	}

	private setReleased(code: KeyCode) {
		this.currentPressed[code] = false;
	}
}

function mouseKeyCode(button: number): KeyCode | null {
	switch (button) {
		case 0:
			return 'MouseLeft';
		case 1:
			return 'MouseMiddle';
		case 2:
			return 'MouseRight';
		case 3:
			return 'Mouse4';
		case 4:
			return 'Mouse5';
		default:
			return null;
	}
}
