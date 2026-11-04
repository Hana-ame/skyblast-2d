// core/sim/physics.ts —— 确定性物理：重力/移动/跳跃/喷射器
import type { Vec2 } from '../types.ts'

// 屏幕坐标系：y 向下为正，重力为 +y
export const GRAVITY = 800        // px/s²（原1200，降低→下落更轻、不砸地）
export const MOVE_SPEED = 300     // px/s（原260，稍快）
export const JUMP_VEL = 520       // 起跳初速（向上，-y）
export const MAX_FALL = 900       // 终端下落速度（原1400，降低→下落不那么沉）
export const JETPACK_ACCEL = 1700  // 喷射器加速度（垂直向上 -y；>GRAVITY=800 才能浮起，净升900）

// 喷射器燃料：有上限，不能无限飘
export const JETPACK_FUEL = 2.5    // 燃料上限（秒）
export const JETPACK_DRAIN = 1.0   // 开启时每秒消耗（秒/s）
export const JETPACK_RECHARGE = 0.8 // 关闭时每秒回充（秒/s）

/** 欧拉积分：pos += vel * dt（确定性） */
export function integrate(p: Vec2, v: Vec2, dt: number): void {
  p.x += v.x * dt
  p.y += v.y * dt
}

export function applyGravity(v: Vec2, dt: number): void {
  v.y += GRAVITY * dt
  if (v.y > MAX_FALL) v.y = MAX_FALL
}

export function move(v: Vec2, dir: -1 | 0 | 1): void {
  v.x = dir * MOVE_SPEED
}

export function jump(v: Vec2): void {
  v.y = -JUMP_VEL
}

/** 喷射器（起飞）：沿【垂直向上 -y】推进（W/空格=起飞，垂直上升，不看瞄准方向）；加速度>重力可浮起 */
export function jetpack(v: Vec2, _aim: number, dt: number): void {
  v.y -= JETPACK_ACCEL * dt
}

/** 喷射器燃料更新：active 时按 drain 消耗，否则按 recharge 回充；夹到 [0, JETPACK_FUEL] */
export function updateJetpackFuel(fuel: number, active: boolean, dt: number): number {
  const next = active ? fuel - JETPACK_DRAIN * dt : fuel + JETPACK_RECHARGE * dt
  return Math.min(JETPACK_FUEL, Math.max(0, next))
}

/** 防穿透/防瞬移：把 dt 拆成不超过 maxStep 的小步数组，供调用方循环推进，避免高速物体一步穿过薄墙/平台 */
export function substep(dt: number, maxStep = 1 / 120): number[] {
  if (dt <= 0) return []
  if (maxStep <= 0) return [dt]
  const n = Math.ceil(dt / maxStep)
  const step = dt / n // 均分 → 每步 ≤ maxStep，且确定
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(step)
  return out
}
