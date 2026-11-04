// core/sim/projectile.ts —— 弹道（受重力抛物线）
import { applyGravity, integrate } from './physics.ts'
import type { Projectile, Vec2 } from '../types.ts'

export const PROJECTILE_SPEED = 900
export const PROJECTILE_LIFE = 2.5
export const PROJECTILE_R = 5

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
  p.life -= dt
}
