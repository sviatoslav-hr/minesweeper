import type { Rect, Vec2 } from '$math';

type TextMetricsRendered = {
	/** Text's advance width (the width of that inline box) in CSS pixels. */
	width: number;
	/** Distance from the horizontal line indicated by the `textBaseline` attribute to the top of the bounding rectangle used to render the text, in CSS pixels. */
	actualBoundingBoxAscent: number;
};
type FontRendered = { size: number; family: string };

export class Renderer2d {
	context: CanvasRenderingContext2D;
	camera: Camera | null = null;
	font: FontRendered = { size: 16, family: 'Arial' };
	private fontBeforeCameraMode = this.font;

	constructor(context: CanvasRenderingContext2D) {
		this.context = context;
		this.setFont(this.font);
	}

	get canvas(): HTMLCanvasElement {
		return this.context.canvas;
	}

	setFont(font: FontRendered, ignoreCameraScale = false) {
		if (this.camera && !ignoreCameraScale) {
			this.fontBeforeCameraMode = font;
			font = { ...font, size: font.size * this.camera.scale };
		}
		const fontStr = `${font.size}px ${font.family}`;
		this.font = font;
		this.context.font = fontStr;
	}

	beginCameraMode(camera: Camera) {
		this.camera = camera;
		// NOTE: Store font size to avoid precision issues when restoring it back.
		this.fontBeforeCameraMode = this.font;
		this.setFont(
			{ ...this.font, size: this.font.size * camera.scale },
			true,
		);
	}

	endCameraMode() {
		this.camera = null;
		this.setFont(this.fontBeforeCameraMode);
	}

	fillScreen(color: string) {
		this.context.fillStyle = color;
		this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
	}

	drawRect(rect: Rect, color: string): void;
	drawRect(
		x: number,
		y: number,
		width: number,
		height: number,
		color: string,
	): void;
	drawRect(
		xOrRect: number | Rect,
		yOrColor: number | string,
		maybeWidth?: number,
		maybeHeight?: number,
		maybeColor?: string,
	): void {
		let rect: Rect;
		let color: string;
		if (typeof xOrRect === 'number') {
			rect = {
				x: xOrRect,
				y: yOrColor as number,
				width: maybeWidth ?? 0,
				height: maybeHeight ?? 0,
			};
			color = maybeColor ?? '';
		} else {
			rect = xOrRect;
			color = yOrColor as string;
		}
		this.context.fillStyle = color;
		if (this.camera) {
			rect = this.camera.toScreenRect(rect);
		}
		this.context.fillRect(rect.x, rect.y, rect.width, rect.height);
	}

	drawLine(start: Vec2, end: Vec2, color: string, lineWidth = 1) {
		this.context.strokeStyle = color;
		this.context.lineWidth = lineWidth;
		if (this.camera) {
			start = this.camera.toScreen2(start);
			end = this.camera.toScreen2(end);
		}
		this.context.beginPath();
		this.context.moveTo(start.x, start.y);
		this.context.lineTo(end.x, end.y);
		this.context.stroke();
	}

	drawText(text: string, position: Vec2, color: string) {
		this.context.fillStyle = color;
		let screenPosition = position;
		if (this.camera) {
			screenPosition = this.camera.toScreen2(position);
		}
		this.context.fillText(text, screenPosition.x, screenPosition.y);
	}

	measureText(text: string): TextMetricsRendered {
		const metricsScreen = this.context.measureText(text);
		const metrics: TextMetricsRendered = {
			width: metricsScreen.width,
			actualBoundingBoxAscent: metricsScreen.actualBoundingBoxAscent,
		};
		if (this.camera) {
			metrics.width /= this.camera.scale;
			metrics.actualBoundingBoxAscent /= this.camera.scale;
		}
		return metrics;
	}

	resizeCanvas(width: number, height: number): void {
		this.canvas.style.width = width + 'px';
		this.canvas.style.height = height + 'px';
		this.canvas.width = width;
		this.canvas.height = height;
	}
}

export class Camera {
	worldOffset: Vec2 = { x: 0, y: 0 };
	screenOffset: Vec2 = { x: 0, y: 0 };
	scale: number = 1;

	toScreen2(worldPosition: Vec2): Vec2 {
		const screenPosition: Vec2 = {
			x: this.toScreenX(worldPosition.x),
			y: this.toScreenY(worldPosition.y),
		};
		return screenPosition;
	}

	toScreenRect(worldRect: Rect): Rect {
		const x = this.toScreenX(worldRect.x);
		const y = this.toScreenY(worldRect.y);
		const width = worldRect.width * this.scale;
		const height = worldRect.height * this.scale;
		return { x, y, width, height };
	}

	toScreenX(worldX: number): number {
		const screenX =
			(worldX - this.worldOffset.x) * this.scale + this.screenOffset.x;
		return screenX;
	}

	toScreenY(worldY: number): number {
		const screenY =
			(worldY - this.worldOffset.y) * this.scale + this.screenOffset.y;
		return screenY;
	}

	toWorld2(screenPosition: Vec2): Vec2 {
		const worldPosition: Vec2 = {
			x: this.toWorldX(screenPosition.x),
			y: this.toWorldY(screenPosition.y),
		};
		return worldPosition;
	}

	toWorldRect(screenRect: Rect): Rect {
		const x = this.toWorldX(screenRect.x);
		const y = this.toWorldY(screenRect.y);
		const width = screenRect.width / this.scale;
		const height = screenRect.height / this.scale;
		return { x, y, width, height };
	}

	toWorldX(screenX: number): number {
		const worldX =
			(screenX - this.screenOffset.x) / this.scale + this.worldOffset.x;
		return worldX;
	}
	toWorldY(screenY: number): number {
		const worldY =
			(screenY - this.screenOffset.y) / this.scale + this.worldOffset.y;
		return worldY;
	}
}
