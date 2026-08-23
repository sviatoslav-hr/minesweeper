export type Vec2 = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

// TODO: Try grouping these functions in a scope for convenience.
export function v2Sub(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x - b.x, y: a.y - b.y };
}
export function v2Min(a: Vec2, x: number, y: number): Vec2 {
	return { x: Math.min(a.x, x), y: Math.min(a.y, y) };
}
export function v2Max(a: Vec2, x: number, y: number): Vec2 {
	return { x: Math.max(a.x, x), y: Math.max(a.y, y) };
}
export function v2Set(target: Vec2, x: number, y: number): Vec2 {
	target.x = x;
	target.y = y;
	return target;
}
export function v2SetFrom(target: Vec2, source: Vec2): Vec2 {
	return v2Set(target, source.x, source.y);
}
export function v2Clone(source: Vec2): Vec2 {
	return { x: source.x, y: source.y };
}

export function isInsideRect(point: Vec2, rect: Rect): boolean {
	return (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	);
}

export function scaleRectCentered(rect: Rect, scale: number): Rect {
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	return {
		x: cx - (rect.width * scale) / 2,
		y: cy - (rect.height * scale) / 2,
		width: rect.width * scale,
		height: rect.height * scale,
	};
}
