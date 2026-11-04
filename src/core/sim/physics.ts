// core/sim/physics.ts —— 确定性物理：重力/移动/跳跃/喷射器
// 参数集中为 PhysicsParams，可运行时 setPhysicsParams 覆盖（供 tuning.html 调参），默认值即手感基线
import type { Vec2 } from '../types.ts'

// 屏幕坐标系：y 向下为正，重力为 +y
export const GRAVITY = 450        // px/s²（下落轻、飘）
export const MOVE_SPEED = 160     // px/s 水平极速
export const MOVE_ACCEL = 170     // px/s² 水平加速度：160/170≈0.94s 到顶（1秒内到极速）
export const JUMP_VEL = 520       // 起跳初速（向上，-y）
export const MAX_FALL = 650       // 终端下落速度
export const JETPACK_ACCEL = 1500  // 喷射器加速度（垂直向上 -y；净升 1500-450=1050）
export const JETPACK_MAX_UP = 620  // 喷射上升速度上限（vy 不得小于 -JETPACK_MAX_UP，防止无限加速）

// 喷射器燃料：有上限，不能无限飘
export const JETPACK_FUEL = 2.5    // 燃料上限（秒）
export const JETPACK_DRAIN = 1.0   // 开启时每秒消耗（秒/s）
export const JETPACK_RECHARGE = 0.8 // 关闭时每秒回充（秒/s）

/** 全部可调物理参数（默认=当前手感基线） */
export interface PhysicsParams {
  mass: number          // 质量：统一缩放所有加速度（÷mass），越大越"重"（难加速/飞不动）；1=基准
  friction: number      // 地面摩擦：无方向输入时水平速度按此系数衰减（越大滑得越短/停越快）
  gravity: number
  moveSpeed: number
  moveAccel: number
  jumpVel: number
  maxFall: number
  jetpackAccel: number
  jetpackMaxUp: number
  jetpackFuel: number
  jetpackDrain: number
  jetpackRecharge: number
}

const defaults: PhysicsParams = {
  mass: 1,
  friction: 2.0,
  gravity: GRAVITY,
  moveSpeed: MOVE_SPEED,
  moveAccel: MOVE_ACCEL,
  jumpVel: JUMP_VEL,
  maxFall: MAX_FALL,
  jetpackAccel: JETPACK_ACCEL,
  jetpackMaxUp: JETPACK_MAX_UP,
  jetpackFuel: JETPACK_FUEL,
  jetpackDrain: JETPACK_DRAIN,
  jetpackRecharge: JETPACK_RECHARGE,
}

let P: PhysicsParams = { ...defaults }

/** 读当前参数（供 HUD/tuning 展示） */
export function getPhysicsParams(): PhysicsParams {
  return { ...P }
}

/** 运行时覆盖参数（部分字段缺省则保持现值）；返回最终生效参数 */
export function setPhysicsParams(overrides: Partial<PhysicsParams>): PhysicsParams {
  P = { ...P, ...overrides }
  return { ...P }
}

/** 重置为默认手感 */
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

export function move(v: Vec2, dir: -1 | 0 | 1, dt: number): void {
  const target = dir * P.moveSpeed
  if (dir !== 0) {
    if (v.x < target) v.x = Math.min(target, v.x + (P.moveAccel / P.mass) * dt)
    else if (v.x > target) v.x = Math.max(target, v.x - (P.moveAccel / P.mass) * dt)
  } else if (v.x !== 0) {
    // 无方向输入：地面摩擦衰减（指数衰减，越大停越快/滑得越短），比线性减速更自然
    const f = Math.exp(-P.friction * dt)
    v.x *= f
    if (Math.abs(v.x) < 2) v.x = 0 // 低速截断，避免永远微滑
  }
}

export function jump(v: Vec2): void {
  v.y = -P.jumpVel
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
