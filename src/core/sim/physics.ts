// core/sim/physics.ts —— 确定性物理：重力/移动/跳跃/喷射器
import type { Vec2 } from '../types.ts'

// 屏幕坐标系：y 向下为正，重力为 +y
export const GRAVITY = 1200       // px/s²
export const MOVE_SPEED = 260     // px/s
export const JUMP_VEL = 520       // 起跳初速（向上，-y）
export const MAX_FALL = 1400      // 终端下落速度
export const JETPACK_ACCEL = 900  // 喷射器加速度（沿 -aim 方向）

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

/** 喷射器：沿瞄准反方向推进（Teeworlds 风格），抵消部分重力 */
export function jetpack(v: Vec2, aim: number, dt: number): void {
  v.x += -Math.cos(aim) * JETPACK_ACCEL * dt
  v.y += -Math.sin(aim) * JETPACK_ACCEL * dt
}
