import type { Rect, Vec2 } from '$math';

type TextMetricsRendered = {
	/** Text's advance width (the width of that inline box) in CSS pixels. */
	width: number;
	/** Distance from the horizontal line indicated by the `textBaseline` attribute to the top of the bounding rectangle used to render the text, in CSS pixels. */
	actualBoundingBoxAscent: number;
	/** Distance from the horizontal line indicated by the `textBaseline` attribute to the bottom of the bounding rectangle used to render the text, in CSS pixels. */
	actualBoundingBoxDescent: number;
};
type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type FontRendered = {
	size: number;
	weight?: FontWeight;
	family: string;
};

const DEG2RAD = Math.PI / 180;

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
		const weight = font.weight ?? 400;
		const fontStr = ` ${weight} ${font.size}px ${font.family}`;
		this.font = font;
		this.context.font = fontStr;
	}

	beginCameraMode(camera: Camera) {
		this.camera = camera;
		// NOTE: Store font size to avoid precision issues when restoring it back.
		this.fontBeforeCameraMode = this.font;
		this.setFont({ ...this.font, size: this.font.size * camera.scale }, true);
	}

	endCameraMode() {
		this.camera = null;
		this.setFont(this.fontBeforeCameraMode);
	}

	fillScreen(color: string) {
		this.context.fillStyle = color;
		this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
	}

	drawTriangle(v1: Vec2, v2: Vec2, v3: Vec2, color: string): void {
		this.context.fillStyle = color;
		if (this.camera) {
			v1 = this.camera.toScreen2(v1);
			v2 = this.camera.toScreen2(v2);
			v3 = this.camera.toScreen2(v3);
		}
		this.context.beginPath();
		this.context.moveTo(v1.x, v1.y);
		this.context.lineTo(v2.x, v2.y);
		this.context.lineTo(v3.x, v3.y);
		this.context.closePath();
		this.context.fill();
	}

	drawRect(rect: Rect, color: string): void;
	drawRect(x: number, y: number, width: number, height: number, color: string): void;
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

	drawRectRounded(rect: Rect, radius: number, color: string): void {
		this.context.fillStyle = color;
		if (this.camera) {
			rect = this.camera.toScreenRect(rect);
		}
		this.context.beginPath();
		this.context.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
		this.context.fill();
	}

	drawRectOutlineRounded(rect: Rect, radius: number, color: string, lineWidth = 1): void {
		this.context.strokeStyle = color;
		this.context.lineWidth = lineWidth;
		if (this.camera) {
			rect = this.camera.toScreenRect(rect);
		}
		this.context.beginPath();
		this.context.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
		this.context.stroke();
	}

	drawRectOutline(rect: Rect, color: string, lineWidth = 1): void {
		this.context.strokeStyle = color;
		this.context.lineWidth = lineWidth;
		if (this.camera) {
			rect = this.camera.toScreenRect(rect);
		}
		this.context.strokeRect(rect.x, rect.y, rect.width, rect.height);
	}

	drawCircle(position: Vec2, radius: number, color: string): void {
		this.drawArc(position, radius, 0, 360, color);
	}

	drawCircleOutline(position: Vec2, radius: number, color: string, lineWidth?: number): void {
		this.drawArcOutline(position, radius, 0, 360, color, lineWidth);
	}

	drawArc(position: Vec2, radius: number, startAngle: number, endAngle: number, color: string): void {
		this.context.fillStyle = color;
		this.context.beginPath();
		if (this.camera) {
			position = this.camera.toScreen2(position);
			radius *= this.camera.scale;
		}
		this.context.arc(position.x, position.y, radius, startAngle * DEG2RAD, endAngle * DEG2RAD);
		this.context.fill();
	}

	drawArcOutline(
		position: Vec2,
		radius: number,
		startAngle: number,
		endAngle: number,
		color: string,
		lineWidth = 1,
	): void {
		this.context.lineWidth = lineWidth;
		this.context.strokeStyle = color;
		this.context.beginPath();
		if (this.camera) {
			position = this.camera.toScreen2(position);
			radius *= this.camera.scale;
		}
		this.context.arc(position.x, position.y, radius, startAngle * DEG2RAD, endAngle * DEG2RAD);
		this.context.stroke();
	}

	drawEllipse(position: Vec2, radius: Vec2, color: string): void {
		this.context.fillStyle = color;
		const rotation = 0;
		let { x: rx, y: ry } = radius;
		if (this.camera) {
			position = this.camera.toScreen2(position);
			rx *= this.camera.scale;
			ry *= this.camera.scale;
		}
		this.context.beginPath();
		this.context.ellipse(position.x, position.y, rx, ry, rotation, 0 * DEG2RAD, 360 * DEG2RAD);
		this.context.fill();
	}

	drawImage(src: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void {
		let dest: Rect = { x: dx, y: dy, width: dw, height: dh };
		if (this.camera != null) {
			if (!isRectVisible(this.camera, dest)) {
				return;
			} else {
				dest = this.camera.toScreenRect(dest);
			}
		}
		// drawImage(image: CanvasImageSource, dx: number, dy: number): void;
		// drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
		// drawImage(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
		this.context.drawImage(src, dest.x, dest.y, dest.width, dest.height);
	}

	drawLine(start: Vec2, end: Vec2, color: string, lineWidth = 1, lineCap: CanvasLineCap = 'butt') {
		this.context.strokeStyle = color;
		this.context.lineWidth = lineWidth;
		this.context.lineCap = lineCap;
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
			actualBoundingBoxDescent: metricsScreen.actualBoundingBoxDescent,
		};
		if (this.camera) {
			metrics.width /= this.camera.scale;
			metrics.actualBoundingBoxAscent /= this.camera.scale;
			metrics.actualBoundingBoxDescent /= this.camera.scale;
		}
		return metrics;
	}

	// TODO: Scale the canvas backing resolution and context by devicePixelRatio to avoid blurry high-DPI rendering.
	// Keep layout and pointer coordinates in CSS pixels, and restore context settings after resizing.
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
		const screenX = (worldX - this.worldOffset.x) * this.scale + this.screenOffset.x;
		return screenX;
	}

	toScreenY(worldY: number): number {
		const screenY = (worldY - this.worldOffset.y) * this.scale + this.screenOffset.y;
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
		const worldX = (screenX - this.screenOffset.x) / this.scale + this.worldOffset.x;
		return worldX;
	}
	toWorldY(screenY: number): number {
		const worldY = (screenY - this.screenOffset.y) / this.scale + this.worldOffset.y;
		return worldY;
	}
}

function isRectVisible(camera: Camera, rect: Rect): boolean {
	let { x, y, width, height } = rect;
	x = camera.toScreenX(x);
	y = camera.toScreenY(y);
	width *= camera.scale;
	height *= camera.scale;
	return (
		x < camera.screenOffset.x + width &&
		y < camera.screenOffset.y + height &&
		x + width > camera.screenOffset.x &&
		y + height > camera.screenOffset.y
	);
}
