// core/noita/NoitaWorld.ts —— 仿 Noita：像素可破坏地形 + 落沙 + 360°自由瞄准 + 悬浮飞行（能量）
// 纯 TS 零依赖，确定性 step(dt, inputs)。地形 = Uint8Array 瓦片图（0=空 1=沙 2=石），弹丸命中炸坑。
import type { Vec2 } from '../types.ts'

export const TILE = 4              // 瓦片像素尺寸（逻辑 px）
export const W = 240               // 地形宽（瓦片数）→ 240*4=960 逻辑px
export const H = 150               // 地形高（瓦片数）→ 150*4=600 逻辑px
export const EMPTY = 0
export const SAND = 1
export const STONE = 2

export interface NoitaInput {
  move: -1 | 0 | 1
  hover: boolean          // 悬浮（W/空格）：耗能量
  moveY: -1 | 0 | 1       // 上下飞（触屏右摇杆/桌面暂无，保留）
  aim: number             // 360° 自由瞄准
  fire: boolean
}

export function defaultNoitaInput(): NoitaInput {
  return { move: 0, hover: false, moveY: 0, aim: 0, fire: false }
}

export interface NoitaPlayer {
  id: number
  pos: Vec2
  vel: Vec2
  aim: number
  hp: number
  energy: number          // 悬浮能量 [0,1]，落地回充
  alive: boolean
  kills: number
  deaths: number
  fireCd: number
}

export interface NoitaProjectile {
  id: number
  owner: number
  pos: Vec2
  vel: Vec2
  life: number
}

export const GRAVITY = 900
export const MOVE_SPEED = 180
export const ACCEL = 1400
export const FRICTION = 30            // 地面摩擦 λ
export const AIR_FRICTION = 1.5
export const HOVER_ACCEL = 1900       // 悬浮升力（>重力 900）
export const HOVER_MAX_UP = 320       // 悬浮升速上限
export const ENERGY_MAX = 1
export const ENERGY_DRAIN = 0.5       // 悬浮每秒消耗（1=满能量悬浮2s）
export const ENERGY_RECHARGE = 0.65   // 落地每秒回充
export const FIRE_CD = 0.25
export const BULLET_SPEED = 480
export const BULLET_LIFE = 2.5
export const BLAST_R = 5              // 炸坑半径（瓦片）
export const FIRE_DAMAGE = 25
export const PLAYER_R = 6             // 玩家碰撞半径（逻辑 px）

export class NoitaWorld {
  players: NoitaPlayer[] = []
  projectiles: NoitaProjectile[] = []
  // 行主序地形：idx = x + y*W
  tiles: Uint8Array = new Uint8Array(W * H)
  tick = 0
  private pid = 1
  private prj = 1

  constructor() {
    this.genTerrain()
  }

  /** 生成地形：底部石头 + 起伏沙面 + 中间挖出两玩家平台 + 浮空石岛 */
  private genTerrain(): void {
    const t = this.tiles
    // 基岩底：下 30 行石头
    for (let y = H - 30; y < H; y++)
      for (let x = 0; x < W; x++)
        t[x + y * W] = STONE
    // 起伏沙面（正弦叠加，确定）
    for (let x = 0; x < W; x++) {
      const h = H - 30 - Math.floor(10 + 8 * Math.sin(x / 14) + 5 * Math.sin(x / 3.7 + 2))
      for (let y = h; y < H - 30; y++)
        t[x + y * W] = SAND
    }
    // 挖出玩家出生区（左 40-60，右 180-200，宽 20、高 12 的空腔）
    const carve = (cx: number) => {
      for (let y = H - 52; y < H - 36; y++)
        for (let x = cx - 10; x <= cx + 10; x++)
          t[x + y * W] = EMPTY
    }
    carve(50)
    carve(190)
    // 中间浮空石岛（掩体）
    for (let y = H - 75; y < H - 68; y++)
      for (let x = 100; x <= 140; x++)
        t[x + y * W] = STONE
  }

  addPlayer(x: number, y: number): NoitaPlayer {
    const p: NoitaPlayer = {
      id: this.pid++,
      pos: { x, y }, vel: { x: 0, y: 0 },
      aim: 0, hp: 100, energy: ENERGY_MAX, alive: true, kills: 0, deaths: 0, fireCd: 0,
    }
    this.players.push(p)
    return p
  }

  tileAt(px: number, py: number): number {
    const x = Math.floor(px / TILE), y = Math.floor(py / TILE)
    if (x < 0 || x >= W || y < 0 || y >= H) return STONE // 边界外算实体（挡）
    return this.tiles[x + y * W]
  }

  /** 圆 vs 地形采样碰撞：返回是否碰到实体（地图边界外算实体，与 tileAt 一致） */
  private circleHit(px: number, py: number, r: number): boolean {
    const x0 = Math.floor((px - r) / TILE), x1 = Math.floor((px + r) / TILE)
    const y0 = Math.floor((py - r) / TILE), y1 = Math.floor((py + r) / TILE)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) {
          // 边界外按实体处理（但先做 AABB 相交确认，避免大范围误判）
          const nx = Math.max(x * TILE, Math.min(px, x * TILE + TILE))
          const ny = Math.max(y * TILE, Math.min(py, y * TILE + TILE))
          const dx = px - nx, dy = py - ny
          if (dx * dx + dy * dy < r * r) return true
          continue
        }
        if (this.tiles[x + y * W] !== EMPTY) {
          // 瓦片 AABB 与圆相交
          const nx = Math.max(x * TILE, Math.min(px, x * TILE + TILE))
          const ny = Math.max(y * TILE, Math.min(py, y * TILE + TILE))
          const dx = px - nx, dy = py - ny
          if (dx * dx + dy * dy < r * r) return true
        }
      }
    return false
  }

  /** 玩家落地判定（脚下 1px） */
  private grounded(p: NoitaPlayer): boolean {
    return this.circleHit(p.pos.x, p.pos.y + PLAYER_R + 1, PLAYER_R * 0.4)
  }

  step(dt: number, inputs: Map<number, NoitaInput>): void {
    this.tick++
    // 玩家
    for (const p of this.players) {
      const w = inputs.get(p.id) ?? defaultNoitaInput()
      this.applyPlayer(p, w, dt)
    }
    // 弹丸
    for (const b of this.projectiles) this.stepBullet(b, dt)
    // 弹丸命中玩家
    this.bulletHits()
    this.projectiles = this.projectiles.filter(b => b.life > 0)
    // 落沙（活跃区列表，确定性遍历）
    this.fallSand()
  }

  private applyPlayer(p: NoitaPlayer, w: NoitaInput, dt: number): void {
    const g = this.grounded(p)
    // 水平：地面/空中分离（同移植模型）
    const speed = g ? MOVE_SPEED : MOVE_SPEED * 0.6
    const fric = g ? FRICTION : AIR_FRICTION
    if (w.move < 0) p.vel.x = Math.max(-speed, p.vel.x - ACCEL * dt)
    else if (w.move > 0) p.vel.x = Math.min(speed, p.vel.x + ACCEL * dt)
    else p.vel.x *= Math.exp(-fric * dt)
    // 悬浮：能量门控
    const canHover = w.hover && p.energy > 0
    if (canHover) p.vel.y = Math.max(-HOVER_MAX_UP, p.vel.y - (HOVER_ACCEL - GRAVITY) * dt)
    p.energy = canHover
      ? Math.max(0, p.energy - ENERGY_DRAIN * dt)
      : g ? Math.min(ENERGY_MAX, p.energy + ENERGY_RECHARGE * dt) : p.energy
    // 重力
    if (!canHover) p.vel.y += GRAVITY * dt
    p.vel.y = Math.min(p.vel.y, 420)
    // 位置积分 + 地形碰撞（X/Y 分离）
    this.moveWithCollision(p, dt)
    // 瞄准/开火
    p.aim = w.aim
    p.fireCd = Math.max(0, p.fireCd - dt)
    if (w.fire && p.fireCd <= 0) {
      const muzzle = { x: p.pos.x + Math.cos(p.aim) * 10, y: p.pos.y + Math.sin(p.aim) * 10 }
      this.projectiles.push({ id: this.prj++, owner: p.id, pos: muzzle, vel: { x: Math.cos(p.aim) * BULLET_SPEED, y: Math.sin(p.aim) * BULLET_SPEED }, life: BULLET_LIFE })
      p.fireCd = FIRE_CD
    }
  }

  /** 分离轴移动：先 X 后 Y，撞地形停该轴（挖坑后可穿） */
  private moveWithCollision(p: NoitaPlayer, dt: number): void {
    // X
    let nx = p.pos.x + p.vel.x * dt
    if (!this.circleHit(nx, p.pos.y, PLAYER_R)) p.pos.x = nx
    else {
      // 撞墙：逐像素步进找贴墙点（不瞬移）
      const step = Math.sign(p.vel.x) * 0.5
      let x = p.pos.x
      while (!this.circleHit(x + step, p.pos.y, PLAYER_R)) x += step
      p.pos.x = x
      p.vel.x = 0
    }
    // Y
    let ny = p.pos.y + p.vel.y * dt
    if (!this.circleHit(p.pos.x, ny, PLAYER_R)) p.pos.y = ny
    else {
      const step = Math.sign(p.vel.y) * 0.5
      let y = p.pos.y
      while (!this.circleHit(p.pos.x, y + step, PLAYER_R)) y += step
      p.pos.y = y
      p.vel.y = 0
    }
    // 边界
    p.pos.x = Math.max(PLAYER_R, Math.min(W * TILE - PLAYER_R, p.pos.x))
    p.pos.y = Math.max(PLAYER_R, Math.min(H * TILE - PLAYER_R, p.pos.y))
  }

  private stepBullet(b: NoitaProjectile, dt: number): void {
    // 弹丸受重力（Noita 弹道也下坠）
    b.vel.y += 500 * dt
    b.pos.x += b.vel.x * dt
    b.pos.y += b.vel.y * dt
    b.life -= dt
    // 撞地形 → 炸坑（可破坏地形）
    if (b.life > 0 && this.tileAt(b.pos.x, b.pos.y) !== EMPTY) {
      this.explode(b.pos.x, b.pos.y, BLAST_R)
      b.life = 0
    }
    if (b.pos.x < 0 || b.pos.x > W * TILE || b.pos.y < 0 || b.pos.y > H * TILE) b.life = 0
  }

  /** 炸坑：圆形范围清空瓦片（石头也可炸） */
  explode(cx: number, cy: number, rTiles: number): void {
    const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE)
    for (let y = ty - rTiles; y <= ty + rTiles; y++)
      for (let x = tx - rTiles; x <= tx + rTiles; x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) continue
        if ((x - tx) * (x - tx) + (y - ty) * (y - ty) <= rTiles * rTiles) {
          this.tiles[x + y * W] = EMPTY
        }
      }
  }

  private bulletHits(): void {
    for (const b of this.projectiles) {
      if (b.life <= 0) continue
      for (const p of this.players) {
        if (!p.alive || p.id === b.owner) continue
        const dx = p.pos.x - b.pos.x, dy = p.pos.y - b.pos.y
        if (dx * dx + dy * dy < (PLAYER_R + 3) ** 2) {
          b.life = 0
          p.hp -= FIRE_DAMAGE
          if (p.hp <= 0) this.kill(p)
        }
      }
    }
  }

  private kill(v: NoitaPlayer): void {
    v.deaths++
    v.alive = false
    v.hp = 100
    v.energy = ENERGY_MAX
    // 重生：出生空腔（左/右轮流）
    const left = v.id % 2 === 1
    v.pos = { x: (left ? 50 : 190) * TILE, y: (H - 46) * TILE }
    v.vel = { x: 0, y: 0 }
    v.alive = true
  }

  /** 落沙物理：每 tick 自下而上扫，沙向下掉（含斜滑），已稳定的沙不动 */
  private fallSand(): void {
    const t = this.tiles
    // 自倒数第二行向上扫（y 从 H-2 到 0）：沙向下落
    for (let y = H - 2; y >= 0; y--) {
      for (let x = 0; x < W; x++) {
        const i = x + y * W
        if (t[i] !== SAND) continue
        if (t[i + W] === EMPTY) { t[i + W] = SAND; t[i] = EMPTY }
        else if (x > 0 && t[i - 1 + W] === EMPTY && t[i - 1] === EMPTY) { t[i - 1 + W] = SAND; t[i] = EMPTY }
        else if (x < W - 1 && t[i + 1 + W] === EMPTY && t[i + 1] === EMPTY) { t[i] = EMPTY; t[i + 1 + W] = SAND }
        // 石头不动
      }
    }
    // 瓦片坐标下边界：最底行沙固定（基岩）
  }
}
