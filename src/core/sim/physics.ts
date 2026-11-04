// core/sim/physics.ts —— 物理模型（移植自开源横版射击的 CCharacterCore 模型，纯 TS 无依赖，纯 web）
// 原实现 50 tick/s、参数 per-tick；换算：速度 ×50 → px/s，加速度 ×2500 → px/s²，
// 摩擦按每 tick 乘数 f 换算成指数衰减 e^(-λ·t)，λ = -ln(f)·50
//   gravity 0.5/tick²    → 1250 px/s²
//   ground_speed 10/tick → 500 px/s      ground_accel 2/tick² → 5000 px/s²   ground_friction 0.5  → λ=34.7
//   air_speed 5/tick     → 250 px/s      air_accel 1.5/tick²  → 3750 px/s²   air_friction 0.95    → λ=2.56
//   ground_jump 13.2/tick→ 660 px/s      air_jump 12/tick     → 600 px/s
// 屏幕坐标系：y 向下为正，重力为 +y
import type { Vec2 } from '../types.ts'

/** 全部可调物理参数（默认值=上述换算基线；mass 是本项目自加的惯性缩放，1=无影响） */
export interface PhysicsParams {
  mass: number
  gravity: number
  groundControlSpeed: number
  groundControlAccel: number
  groundFriction: number
  airControlSpeed: number
  airControlAccel: number
  airFriction: number
  groundJumpImpulse: number
  airJumpImpulse: number
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
  groundControlSpeed: 500,
  groundControlAccel: 5000,
  groundFriction: 34.7,
  airControlSpeed: 250,
  airControlAccel: 3750,
  airFriction: 2.56,
  groundJumpImpulse: 660,
  airJumpImpulse: 600,
  maxFall: 1200,
  jetpackAccel: 2600,   // 净升 2600-1250=1350，0.46s 冲到升速上限，爆发力对齐参考起跳脉冲 660
  jetpackMaxUp: 620,
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

/** SaturatedAdd（移植）：把 current 朝 [min,max] 内加 add，不越界；已在界外则不动（不硬拉回） */
function saturatedAdd(min: number, max: number, current: number, add: number): number {
  if (add < 0) return current > min ? Math.max(current + add, min) : current
  return current < max ? Math.min(current + add, max) : current
}

export function applyGravity(v: Vec2, dt: number): void {
  v.y += (P.gravity / P.mass) * dt
  if (v.y > P.maxFall) v.y = P.maxFall
}

/**
 * 水平移动（移植）：地面/空中各自的速度上限/加速度/摩擦；
 * 有输入 → SaturatedAdd 朝目标加速（饱和不越界）；无输入 → 指数摩擦衰减
 */
export function move(v: Vec2, dir: -1 | 0 | 1, dt: number, grounded: boolean): void {
  const speed = grounded ? P.groundControlSpeed : P.airControlSpeed
  const accel = ((grounded ? P.groundControlAccel : P.airControlAccel) / P.mass) * dt
  const fric = grounded ? P.groundFriction : P.airFriction
  if (dir < 0) v.x = saturatedAdd(-speed, speed, v.x, -accel)
  else if (dir > 0) v.x = saturatedAdd(-speed, speed, v.x, accel)
  else {
    v.x *= Math.exp(-fric * dt)
    if (Math.abs(v.x) < 1) v.x = 0
  }
}

export function jump(v: Vec2, grounded: boolean): void {
  v.y = -(grounded ? P.groundJumpImpulse : P.airJumpImpulse)
}

/** 喷射器（起飞）：垂直向上推进；有上升速度上限，不会无限加速 */
export function jetpack(v: Vec2, _aim: number, dt: number): void {
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
