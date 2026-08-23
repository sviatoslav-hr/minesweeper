// PERF: It might not be the very efficient to use string every time to check

import {
	v2Clone,
	v2Max,
	v2Min,
	v2Set,
	v2SetFrom,
	v2Sub,
	type Vec2,
} from '$math';

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
	| 'MouseRight';

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
	private mouse: MouseState = {
		currentPosition: { x: 0, y: 0 },
		previousPosition: { x: 0, y: 0 },
		currentWheenDelta: 0,
		previousWheelDelta: 0,
	};

	isPressed(code: KeyCode): boolean {
		return !this.previousPressed[code] && !!this.currentPressed[code];
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
		return v2Sub(
			v2Clone(this.mouse.previousPosition),
			this.mouse.currentPosition,
		);
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
		switch (ev.button) {
			case 0:
				this.setPressed('MouseLeft');
				break;
			case 1:
				this.setPressed('MouseMiddle');
				break;
			case 2:
				this.setPressed('MouseRight');
				break;
		}
	};
	readonly handleMouseUp = (ev: MouseEvent) => {
		switch (ev.button) {
			case 0:
				this.setReleased('MouseLeft');
				break;
			case 1:
				this.setReleased('MouseMiddle');
				break;
			case 2:
				this.setReleased('MouseRight');
				break;
		}
	};
	readonly handleMouseMove = (ev: MouseEvent, mouseElement?: HTMLElement) => {
		if (!mouseElement) {
			if (ev.target instanceof HTMLElement) {
				mouseElement = ev.target;
			} else {
				this.mouse.currentPosition.x = ev.clientX;
				this.mouse.currentPosition.y = ev.clientY;
				return;
			}
		}
		// NOTE: We need a specific element just in case there are other elements on top
		//       and we want mouse to be handled only for this specific element.
		const x = ev.clientX - mouseElement.offsetLeft;
		const y = ev.clientY - mouseElement.offsetTop;
		v2Min(
			v2Max(v2Set(this.mouse.currentPosition, x, y), 0, 0),
			mouseElement.offsetWidth,
			mouseElement.offsetHeight,
		);
	};
	readonly handleWheel = (ev: WheelEvent) => {
		this.mouse.currentWheenDelta = ev.deltaY;
	};

	listen(element: HTMLElement, mouseElement: HTMLElement) {
		element.addEventListener('keydown', this.handleKeyDown);
		// FIXME: If between ticks happen both keydown and keyup events, the keypress will be missed
		element.addEventListener('keyup', this.handleKeyUp);
		element.addEventListener('mousedown', this.handleMouseDown);
		element.addEventListener('mouseup', this.handleMouseUp);
		element.addEventListener('mousemove', (ev) =>
			this.handleMouseMove(ev, mouseElement),
		);
		element.addEventListener('wheel', this.handleWheel);
	}

	nextTick() {
		this.previousPressed = { ...this.currentPressed };
		v2SetFrom(this.mouse.previousPosition, this.mouse.currentPosition);
		this.mouse.previousWheelDelta = this.mouse.currentWheenDelta;
		this.mouse.currentWheenDelta = 0;
	}

	private setPressed(code: KeyCode) {
		this.currentPressed[code] = true;
	}

	private setReleased(code: KeyCode) {
		this.currentPressed[code] = false;
	}
}
