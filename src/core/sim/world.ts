// core/sim/world.ts —— 服务器权威世界模拟（确定性，零 IO，可在服务端复用）
import { applyGravity, integrate, jetpack, jump, move } from './physics.ts'
import { fireProjectile, stepProjectile } from './projectile.ts'
import { defaultWorldInput } from '../types.ts'
import type { PlayerState, Projectile, WorldInput, WorldSnapshot } from '../types.ts'

export const GROUND_Y = 540
export const WALL_L = 40
export const WALL_R = 920
export const PLAYER_R = 18
export const FIRE_COOLDOWN = 0.22
export const MAG_SIZE = 8
export const FIRE_DAMAGE = 34
export const SPAWNS = [
  { x: 200, y: GROUND_Y },
  { x: 760, y: GROUND_Y },
]

export class World {
  players: PlayerState[] = []
  projectiles: Projectile[] = []
  tick = 0
  hits = 0
  private pid = 1
  private prj = 1
  private cooldowns = new Map<number, number>()
  private spawnIndex = 0

  addPlayer(x: number, y: number): PlayerState {
    const p: PlayerState = {
      id: this.pid++,
      pos: { x, y }, vel: { x: 0, y: 0 },
      aim: 0, hp: 100, ammo: MAG_SIZE,
      jetpack: false, alive: true, kills: 0, deaths: 0,
    }
    this.players.push(p)
    this.cooldowns.set(p.id, 0)
    return p
  }

  step(dt: number, inputs: Map<number, WorldInput>): void {
    this.tick++
    for (const p of this.players) {
      const w = inputs.get(p.id) ?? defaultWorldInput()
      this.apply(p, w, dt)
      this.physics(p, dt)
    }
    for (const pr of this.projectiles) stepProjectile(pr, dt)
    this.collide()
    this.projectiles = this.projectiles.filter(pr => pr.life > 0)
  }

  private apply(p: PlayerState, w: WorldInput, dt: number): void {
    p.aim = w.aim
    move(p.vel, w.move)
    if (w.jump && this.onGround(p)) jump(p.vel)
    if (w.jetpack) jetpack(p.vel, p.aim, dt)
    const cd = this.cooldowns.get(p.id) ?? 0
    this.cooldowns.set(p.id, Math.max(0, cd - dt))
    if (w.fire && cd <= 0 && p.ammo > 0 && p.alive) {
      const muzzle = { x: p.pos.x + Math.cos(p.aim) * 26, y: p.pos.y + Math.sin(p.aim) * 26 }
      this.projectiles.push(fireProjectile(p.id, muzzle, p.aim, this.prj++))
      p.ammo--
      this.cooldowns.set(p.id, FIRE_COOLDOWN)
    }
  }

  private physics(p: PlayerState, dt: number): void {
    applyGravity(p.vel, dt)
    integrate(p.pos, p.vel, dt)
    if (p.pos.y >= GROUND_Y) { p.pos.y = GROUND_Y; p.vel.y = 0 }
    if (p.pos.x < WALL_L) { p.pos.x = WALL_L; p.vel.x = Math.max(0, p.vel.x) }
    if (p.pos.x > WALL_R) { p.pos.x = WALL_R; p.vel.x = Math.min(0, p.vel.x) }
  }

  private onGround(p: PlayerState): boolean {
    return p.pos.y >= GROUND_Y - 0.5
  }

  private collide(): void {
    for (const pr of this.projectiles) {
      if (pr.life <= 0) continue
      for (const p of this.players) {
        if (pr.owner === p.id || !p.alive) continue
        const dx = pr.pos.x - p.pos.x
        const dy = pr.pos.y - p.pos.y
        if (dx * dx + dy * dy < (pr.r + PLAYER_R) ** 2) {
          pr.life = 0
          this.hits++
          p.hp -= FIRE_DAMAGE
          if (p.hp <= 0) this.kill(p, pr.owner)
          break
        }
      }
    }
  }

  private kill(victim: PlayerState, killerId: number): void {
    const killer = this.players.find(x => x.id === killerId)
    if (killer) killer.kills++
    victim.deaths++
    victim.alive = false
    this.respawn(victim)
  }

  private respawn(p: PlayerState): void {
    const s = SPAWNS[this.spawnIndex++ % SPAWNS.length]
    p.pos = { x: s.x, y: s.y }
    p.vel = { x: 0, y: 0 }
    p.hp = 100
    p.ammo = MAG_SIZE
    p.alive = true
  }

  snapshot(): WorldSnapshot {
    return {
      tick: this.tick,
      players: this.players.map(p => ({ ...p, pos: { ...p.pos }, vel: { ...p.vel } })),
      projectiles: this.projectiles.map(pr => ({ ...pr, pos: { ...pr.pos }, vel: { ...pr.vel } })),
    }
  }
}
