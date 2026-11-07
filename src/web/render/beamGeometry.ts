// web/render/beamGeometry.ts —— 激光段 → 屏幕折线的纯几何（可单测，避免“跨接缝画成横穿全图”重现）
import { WORLD_W, WORLD_H, wrapDeltaX, wrapDeltaY } from '../../core/wrap.ts'

export interface WorldSeg { x1: number; y1: number; x2: number; y2: number }
export interface ScreenSeg { x1: number; y1: number; x2: number; y2: number }

/**
 * 把世界段的端点转成屏幕坐标折线。
 * 关键：每段以「起点屏幕坐标 + 段的最短环形位移」绘制，而不是分别对两端取最短位移——
 * 后者在段跨世界接缝时会让两端朝相反方向展开，画出横穿整张地图的长线（视觉“穿墙”）。
 * 同时按需在接缝另一侧补副本，保证视口边缘不断线。
 */
export function expandBeamSegments(
  segments: WorldSeg[],
  toScreen: (wx: number, wy: number) => { x: number; y: number },
  halfW: number,
  halfH: number,
): ScreenSeg[] {
  const out: ScreenSeg[] = []
  for (const seg of segments) {
    const from = toScreen(seg.x1, seg.y1)
    const dx = wrapDeltaX(seg.x1, seg.x2)
    const dy = wrapDeltaY(seg.y1, seg.y2)
    out.push({ x1: from.x, y1: from.y, x2: from.x + dx, y2: from.y + dy })
    for (const ox of [-WORLD_W, WORLD_W]) {
      if (from.x + ox < -halfW - 200 || from.x + ox > halfW + 200) continue
      out.push({ x1: from.x + ox, y1: from.y, x2: from.x + dx + ox, y2: from.y + dy })
    }
    for (const oy of [-WORLD_H, WORLD_H]) {
      if (from.y + oy < -halfH - 200 || from.y + oy > halfH + 200) continue
      out.push({ x1: from.x, y1: from.y + oy, x2: from.x + dx, y2: from.y + dy + oy })
    }
  }
  return out
}

/** 一段世界段的世界长度（最短环形位移） */
export function worldSegLength(seg: WorldSeg): number {
  return Math.hypot(wrapDeltaX(seg.x1, seg.x2), wrapDeltaY(seg.y1, seg.y2))
}
