// core/sim/physics.ts —— 物理模型（纯 TS，纯 web）
// 手感需求（用户 2026-11-05）：
//   - 水平：空中/地面同一套，无惯性 —— 按下即极速，松开即停（不保留动量、无摩擦滑行）
//   - 升空：喷射推力>重力，vy 在 ~1s 内渐变到升空极速（预热），之后受力平衡匀速上升
//   - 松开：失去推力只剩重力，vy 从 -maxUp 被重力加速向下坠（物理规律），直到 maxFall
// 极速 = 受力平衡态：喷射净加速 620/s ≈ 1s 从 0 预热到 -620（jetpackAccel = gravity + maxUp）
// 屏幕坐标系：y 向下为正，重力为 +y
import type { Vec2 } from '../types.ts'

export interface PhysicsParams {
  mass: number
  gravity: number
  moveSpeed: number
  jumpImpulse: number
  maxFall: number
  jetpackAccel: number
  jetpackMaxUp: number
  jetpackFuel: number
  jetpackDrain: number
  jetpackRecharge: number
}

const defaults: PhysicsParams = {
  mass: 1,
  gravity: 1250,
  moveSpeed: 300,        // 水平极速（无惯性：按下即达，松开即停）
  jumpImpulse: 660,
  maxFall: 1200,
  jetpackAccel: 1870,    // 推力 = gravity(1250) + maxUp(620)/1s → 净加速 620/s，约 1s 预热到升空极速
  jetpackMaxUp: 620,     // 升空速度上限（受力平衡态，可调）
  jetpackFuel: 2.5,
  jetpackDrain: 1.0,
  jetpackRecharge: 0.8,
}

let P: PhysicsParams = { ...defaults }

export function getPhysicsParams(): PhysicsParams {
  return { ...P }
}

export function setPhysicsParams(overrides: Partial<PhysicsParams>): PhysicsParams {
  P = { ...P, ...overrides }
  return { ...P }
}

export function resetPhysicsParams(): PhysicsParams {
  P = { ...defaults }
  return { ...P }
}

/** 欧拉积分：pos += vel * dt（确定性） */
export function integrate(p: Vec2, v: Vec2, dt: number): void {
  p.x += v.x * dt
  p.y += v.y * dt
}

export function applyGravity(v: Vec2, dt: number): void {
  v.y += (P.gravity / P.mass) * dt
  if (v.y > P.maxFall) v.y = P.maxFall
}

/** 水平移动：无惯性 —— dir 即极速，松开（dir=0）即停；空中/地面不区分 */
export function move(v: Vec2, dir: -1 | 0 | 1): void {
  v.x = dir * P.moveSpeed
}

export function jump(v: Vec2): void {
  v.y = -P.jumpImpulse
}

/** 喷射器（升空）：推力>重力，vy 朝升空极速渐变（~1s 预热），封顶后受力平衡匀速 */
export function jetpack(v: Vec2, dt: number): void {
  v.y = Math.max(-P.jetpackMaxUp, v.y - (P.jetpackAccel / P.mass) * dt)
}

/** 喷射器燃料更新：active 时按 drain 消耗，否则按 recharge 回充；夹到 [0, jetpackFuel] */
export function updateJetpackFuel(fuel: number, active: boolean, dt: number): number {
  const next = active ? fuel - P.jetpackDrain * dt : fuel + P.jetpackRecharge * dt
  return Math.min(P.jetpackFuel, Math.max(0, next))
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
