// web/render/beamGeometry.ts —— 光束段（高斯枪）→ 屏幕折线的纯几何（可单测，避免“跨接缝画成横穿全图”或“跨半世界反射段被误裁消失”）
import { WORLD_W, WORLD_H, wrapDeltaX, wrapDeltaY } from '../../core/wrap.ts'

export interface WorldSeg { x1: number; y1: number; x2: number; y2: number; dx?: number; dy?: number }
export interface ScreenSeg { x1: number; y1: number; x2: number; y2: number }

/**
 * 把世界段的端点转成屏幕坐标折线。
 * 关键：
 * 1. 每段以「起点屏幕坐标 + 段的真实位移 (dx, dy)」绘制，而不是分别对两端取最短位移——
 *    后者在段跨世界接缝时会让两端朝相反方向展开，画出横穿整张地图的长线（视觉“穿墙”）。
 * 2. 对 3×3 周期副本 (ox, oy) ∈ {-WORLD_W, 0, +WORLD_W} × {-WORLD_H, 0, +WORLD_H}，
 *    按「整段包围盒是否与视口相交」裁剪（而非仅判断起点是否在视口内）——
 *    防止起点在半世界之外（如天花板反射回地面 dy=2436 > WORLD_H/2，或远端跨缝段）但终点穿过玩家屏幕的光束被误裁隐形。
 */
export function expandBeamSegments(
  segments: WorldSeg[],
  toScreen: (wx: number, wy: number) => { x: number; y: number },
  halfW: number,
  halfH: number,
): ScreenSeg[] {
  const out: ScreenSeg[] = []
  const padX = halfW + 200
  const padY = halfH + 200
  for (const seg of segments) {
    const from = toScreen(seg.x1, seg.y1)
    // 优先用权威端算好的真实（未 wrap）位移：单段可长于半世界（地面→天花板 2440px>2200），
    // 用 wrapDelta 会折叠成反向最短路径，把光束画反/画短。
    const dx = seg.dx ?? wrapDeltaX(seg.x1, seg.x2)
    const dy = seg.dy ?? wrapDeltaY(seg.y1, seg.y2)
    out.push({ x1: from.x, y1: from.y, x2: from.x + dx, y2: from.y + dy })
    for (const ox of [-WORLD_W, 0, WORLD_W]) {
      for (const oy of [-WORLD_H, 0, WORLD_H]) {
        if (ox === 0 && oy === 0) continue
        const x1 = from.x + ox
        const y1 = from.y + oy
        const x2 = x1 + dx
        const y2 = y1 + dy
        if (Math.max(x1, x2) < -padX || Math.min(x1, x2) > padX) continue
        if (Math.max(y1, y2) < -padY || Math.min(y1, y2) > padY) continue
        out.push({ x1, y1, x2, y2 })
      }
    }
  }
  return out
}

/** 一段世界段的世界长度 */
export function worldSegLength(seg: WorldSeg): number {
  return Math.hypot(seg.dx ?? wrapDeltaX(seg.x1, seg.x2), seg.dy ?? wrapDeltaY(seg.y1, seg.y2))
}
