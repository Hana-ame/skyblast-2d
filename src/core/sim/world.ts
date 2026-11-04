// core/sim/world.ts —— 服务器权威世界模拟（确定性，零 IO，可在服务端复用）
import { applyGravity, integrate, jetpack, jump, move, updateJetpackFuel, JETPACK_FUEL } from './physics.ts'
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

export interface TerrainBox { x: number; y: number; w: number; h: number }

export class World {
  players: PlayerState[] = []
  projectiles: Projectile[] = []
  terrains: TerrainBox[] = []
  tick = 0
  hits = 0
  private pid = 1
  private prj = 1
  private cooldowns = new Map<number, number>()
  private fuel = new Map<number, number>()
  private spawnIndex = 0

  addTerrain(x: number, y: number, w: number, h: number): TerrainBox {
    const t: TerrainBox = { x, y, w, h }
    this.terrains.push(t)
    return t
  }

  addPlayer(x: number, y: number): PlayerState {
    const p: PlayerState = {
      id: this.pid++,
      pos: { x, y }, vel: { x: 0, y: 0 },
      aim: 0, hp: 100, ammo: MAG_SIZE,
      jetpack: false, alive: true, kills: 0, deaths: 0,
    }
    this.players.push(p)
    this.cooldowns.set(p.id, 0)
    this.fuel.set(p.id, JETPACK_FUEL)
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
    this.collideProjectileTerrain()
    this.collide()
    this.projectiles = this.projectiles.filter(pr => pr.life > 0)
  }

  private apply(p: PlayerState, w: WorldInput, dt: number): void {
    p.aim = w.aim
    move(p.vel, w.move)
    if (w.jump && this.onGround(p)) jump(p.vel)
    // 喷射受燃料门控：燃料>0 才生效，并随开/关消耗/回充
    const fuel = this.fuel.get(p.id) ?? 0
    const canJet = w.jetpack && fuel > 0
    if (canJet) jetpack(p.vel, p.aim, dt)
    this.fuel.set(p.id, updateJetpackFuel(fuel, w.jetpack, dt))
    if (w.reload && p.ammo < MAG_SIZE) p.ammo = MAG_SIZE
    const cd = this.cooldowns.get(p.id) ?? 0
    this.cooldowns.set(p.id, Math.max(0, cd - dt))
    if (w.fire && cd <= 0 && p.ammo > 0 && p.alive) {
      const muzzle = { x: p.pos.x + Math.cos(p.aim) * 26, y: p.pos.y + Math.sin(p.aim) * 26 }
      this.projectiles.push(fireProjectile(p.id, muzzle, p.aim, this.prj++))
      p.ammo--
      this.cooldowns.set(p.id, FIRE_COOLDOWN)
    }
  }

  /** 供 UI/HUD 读取玩家燃料 */
  fuelOf(id: number): number {
    return this.fuel.get(id) ?? 0
  }

  private physics(p: PlayerState, dt: number): void {
    applyGravity(p.vel, dt)
    integrate(p.pos, p.vel, dt)
    // 只在【向下运动】时落地清 vy；向上（喷射）的 vy 保留，允许起飞离地
    if (p.pos.y >= GROUND_Y) {
      p.pos.y = GROUND_Y
      if (p.vel.y > 0) p.vel.y = 0
    }
    if (p.pos.x < WALL_L) { p.pos.x = WALL_L; p.vel.x = Math.max(0, p.vel.x) }
    if (p.pos.x > WALL_R) { p.pos.x = WALL_R; p.vel.x = Math.min(0, p.vel.x) }
    this.collideTerrains(p)
  }

  // 玩家圆(PLAYER_R) vs 平台 AABB：最小穿透轴推出，绝不穿入/穿过平台、绝不瞬移
  private collideTerrains(p: PlayerState): void {
    for (const t of this.terrains) {
      const nx = Math.max(t.x, Math.min(p.pos.x, t.x + t.w))
      const ny = Math.max(t.y, Math.min(p.pos.y, t.y + t.h))
      const dx = p.pos.x - nx
      const dy = p.pos.y - ny
      const d2 = dx * dx + dy * dy
      if (d2 >= PLAYER_R * PLAYER_R) continue
      if (d2 === 0) {
        // 圆心落入平台内：按最小穿透方向推出
        const left = p.pos.x - t.x
        const right = t.x + t.w - p.pos.x
        const top = p.pos.y - t.y
        const bottom = t.y + t.h - p.pos.y
        const m = Math.min(left, right, top, bottom)
        if (m === left) { p.pos.x = t.x - PLAYER_R; p.vel.x = Math.min(0, p.vel.x) }
        else if (m === right) { p.pos.x = t.x + t.w + PLAYER_R; p.vel.x = Math.max(0, p.vel.x) }
        else if (m === top) { p.pos.y = t.y - PLAYER_R; p.vel.y = Math.min(0, p.vel.y) }
        else { p.pos.y = t.y + t.h + PLAYER_R; p.vel.y = Math.max(0, p.vel.y) }
      } else {
        const d = Math.sqrt(d2)
        const push = (PLAYER_R - d) / d
        p.pos.x += dx * push
        p.pos.y += dy * push
        if (dy < 0 && p.vel.y > 0) p.vel.y = 0        // 落在顶面
        else if (dy > 0 && p.vel.y < 0) p.vel.y = 0   // 顶到底面
        else if (Math.abs(dx) > Math.abs(dy)) p.vel.x = 0  // 侧挡
      }
    }
  }

  // 弹丸 vs 地形：进入平台即被挡下（形成掩体）
  private collideProjectileTerrain(): void {
    for (const pr of this.projectiles) {
      if (pr.life <= 0) continue
      for (const t of this.terrains) {
        if (
          pr.pos.x > t.x - pr.r && pr.pos.x < t.x + t.w + pr.r &&
          pr.pos.y > t.y - pr.r && pr.pos.y < t.y + t.h + pr.r
        ) {
          pr.life = 0
          break
        }
      }
    }
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
    // 防御：若重生点与地形重叠（卡地里），推出到无重叠位置，防死亡后卡住
    this.pushOutOfTerrains(p)
  }

  // 把玩家从地形重叠中推出（重生/卡住兜底）；返回是否曾重叠
  private pushOutOfTerrains(p: PlayerState): boolean {
    let moved = false
    for (let guard = 0; guard < 8; guard++) {
      let overlapped = false
      for (const t of this.terrains) {
        const nx = Math.max(t.x, Math.min(p.pos.x, t.x + t.w))
        const ny = Math.max(t.y, Math.min(p.pos.y, t.y + t.h))
        const dx = p.pos.x - nx
        const dy = p.pos.y - ny
        if (dx * dx + dy * dy < PLAYER_R * PLAYER_R) {
          overlapped = true
          moved = true
          if (dx === 0 && dy === 0) {
            // 圆心在平台内：向上推出（站在顶面）
            p.pos.y = t.y - PLAYER_R
            p.vel.y = Math.min(0, p.vel.y)
          } else {
            const d = Math.sqrt(dx * dx + dy * dy)
            const push = (PLAYER_R - d) / d
            p.pos.x += dx * push
            p.pos.y += dy * push
          }
        }
      }
      if (!overlapped) break
    }
    return moved
  }

  snapshot(): WorldSnapshot {
    return {
      tick: this.tick,
      players: this.players.map(p => ({ ...p, pos: { ...p.pos }, vel: { ...p.vel } })),
      projectiles: this.projectiles.map(pr => ({ ...pr, pos: { ...pr.pos }, vel: { ...pr.vel } })),
    }
  }
}
