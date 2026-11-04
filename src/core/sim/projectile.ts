// core/sim/projectile.ts —— 弹道（受重力抛物线）
import { applyGravity, integrate } from './physics.ts'
import { GROUND_Y } from './world.ts' // 只读常量，ESM 活绑定，仅 stepProjectile 调用期访问（模块循环安全）
import type { Projectile, Vec2 } from '../types.ts'

export const PROJECTILE_SPEED = 900
export const PROJECTILE_LIFE = 2.5
export const PROJECTILE_R = 5
export const PROJECTILE_BOUNCE = 0.5 // 落地/撞地形时速度衰减系数（保留弹丸结构，不加 bounces 字段）

// id 由 World 分配（模块级计数会破坏跨世界确定性，故不在此持有状态）
export function fireProjectile(owner: number, pos: Vec2, aim: number, id: number): Projectile {
  return {
    id,
    owner,
    pos: { x: pos.x, y: pos.y },
    vel: { x: Math.cos(aim) * PROJECTILE_SPEED, y: Math.sin(aim) * PROJECTILE_SPEED },
    life: PROJECTILE_LIFE,
    r: PROJECTILE_R,
  }
}

export function stepProjectile(p: Projectile, dt: number): void {
  applyGravity(p.vel, dt)      // 弹道受重力 → 抛物线
  integrate(p.pos, p.vel, dt)
  // 贴地弹跳：向下且越过地面线 → 反弹并贴地（保持 Projectile 结构不变，不引入 bounces 字段）
  if (p.vel.y > 0 && p.pos.y > GROUND_Y) {
    p.pos.y = GROUND_Y
    p.vel.y = -p.vel.y * PROJECTILE_BOUNCE
  }
  p.life -= dt
}
