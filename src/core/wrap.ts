// core/wrap.ts —— 环形世界（水平+垂直双轴无缝循环，全环面 torus）数学
// 用户 2026-11-06 指定：上下也是环形的（不止左右）。
// 所有实体/弹道/瞄准/距离的 dx/dy 一律走 wrapDeltaX/wrapDeltaY。
export const WORLD_W = 13200
export const WORLD_H = 4400
export const SURFACE_Y = 2800

/** 规范化 x 到 [0, WORLD_W) */
export function wrapX(x: number): number {
  return ((x % WORLD_W) + WORLD_W) % WORLD_W
}

/** 规范化 y 到 [0, WORLD_H) */
export function wrapY(y: number): number {
  return ((y % WORLD_H) + WORLD_H) % WORLD_H
}

/** 从 fromX 到 toX 的最短有向位移（跨缝感知），值域 (-W/2, W/2] */
export function wrapDeltaX(fromX: number, toX: number): number {
  let dx = wrapX(toX) - wrapX(fromX)
  if (dx > WORLD_W * 0.5) dx -= WORLD_W
  if (dx < -WORLD_W * 0.5) dx += WORLD_W
  return dx
}

/** 从 fromY 到 toY 的最短有向位移（垂直跨缝感知），值域 (-H/2, H/2] */
export function wrapDeltaY(fromY: number, toY: number): number {
  let dy = wrapY(toY) - wrapY(fromY)
  if (dy > WORLD_H * 0.5) dy -= WORLD_H
  if (dy < -WORLD_H * 0.5) dy += WORLD_H
  return dy
}

/** 环形世界两点最短欧氏距离（双轴） */
export function wrapDist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(wrapDeltaX(x1, x2), wrapDeltaY(y1, y2))
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
