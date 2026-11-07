// core/sim/physics.ts —— 物理模型（纯 TS，纯 web）
// 手感需求（用户 2026-11-05）+ 调优台实测参数固化（用户确认"这个参数不错"）：
//   - 水平：空中/地面同一套，无惯性 —— 按下即极速，松开即停（不保留动量、无摩擦滑行）
//   - 升空：喷射推力>重力，vy 渐变到升空极速后受力平衡匀速（预热时间 = maxUp·mass/(accel−gravity) ≈ 0.21s）
//   - 松开：失去推力只剩重力，vy 被重力加速下坠（物理规律），直到 maxFall
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
  mass: 1.3,             // 用户调优值：稍重
  gravity: 1250,
  moveSpeed: 300,        // 水平极速（无惯性：按下即达，松开即停）
  jumpImpulse: 490,      // 用户调优值
  maxFall: 1200,
  jetpackAccel: 4200,    // 更快响应：净加速 (4200-1250)/1.3 ≈ 2269/s → 约 0.12s 到升空极速（原 3000≈0.21s）
  jetpackMaxUp: 280,     // 用户调优值：升空速度上限（短促小跳手感）
  jetpackFuel: 1.0,      // 飞行槽 = 原值 0.5 的两倍：满能量可喷 2s（drain 0.5）
  jetpackDrain: 0.5,     // 每秒消耗半槽
  jetpackRecharge: 0.7,  // 落地回充：约 1.43s 回满（空中不回充）
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

/** 重力：mult>1 为主动俯冲（下降加速），速度上限相应放宽但仍有封顶（防穿透/防失控） */
export function applyGravity(v: Vec2, dt: number, mult = 1): void {
  v.y += (P.gravity / P.mass) * mult * dt
  const cap = mult > 1 ? P.maxFall * 1.6 : P.maxFall
  if (v.y > cap) v.y = cap
}

/** 水平移动：无惯性 —— dir 即极速，松开（dir=0）即停；空中/地面不区分 */
export function move(v: Vec2, dir: -1 | 0 | 1): void {
  v.x = dir * P.moveSpeed
}

export function jump(v: Vec2): void {
  v.y = -P.jumpImpulse
}

/** 喷射器（升空）：推力>重力，vy 朝升空极速渐变（~1s 预热），封顶后受力平衡匀速 */
export function jetpack(v: Vec2, dt: number, ascendMult = 1): void {
  // ascendMult：武器对「升空速度」的倍率（手枪 1.25，其余 1）
  v.y = Math.max(-P.jetpackMaxUp * ascendMult, v.y - (P.jetpackAccel * ascendMult / P.mass) * dt)
}

/** 喷射器燃料更新：active 时按 drain 消耗；**仅在落地时**按 recharge 回充；
 *  空中不回充 → 修复「断续点按 W 无限飞」的漏洞（此前空中也在回充，占空比足够就永动） */
export function updateJetpackFuel(fuel: number, active: boolean, onGround: boolean, dt: number, maxFuel = P.jetpackFuel): number {
  const next = active
    ? fuel - P.jetpackDrain * dt
    : (onGround ? fuel + P.jetpackRecharge * dt : fuel)
  return Math.min(maxFuel, Math.max(0, next))
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


/**
 * 射击后坐力：沿瞄准反方向、**各向同性**（水平/垂直/斜向使用同一系数）。
 * 旧实现水平 ×0.56、垂直 ×0.65，导致霰弹上下后坐明显大于左右；这里统一为同一系数。
 */
export const RECOIL_SCALE = 0.56
export function recoilDelta(recoil: number, aim: number): { x: number; y: number } {
  return { x: -Math.cos(aim) * recoil * RECOIL_SCALE, y: -Math.sin(aim) * recoil * RECOIL_SCALE }
}
