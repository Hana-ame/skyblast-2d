// core/sim/world.ts —— 服务器权威世界模拟（确定性，零 IO，可在服务端复用）
// 合并改造：保留骨架的确定性 step 结构与调优物理参数；灌入 SkyBlast v2 全部玩法系统：
//   环形地图碰撞 / 7 主武器+8 副武器 / 爆头穿透 / 有限备弹换弹 / 替身人偶回溯 /
//   受重力地雷(直击+瞬发) / 空袭 / 可破坏障碍物 / 占领点 / 弹药经济 / 补给箱 / 迫击炮
// 单位制：秒制（v2 px/frame@60 → px/s：速度×60）。随机量全部走注入的 Rng。
import { applyGravity, jetpack, jump, move, updateJetpackFuel, getPhysicsParams } from './physics.ts'
import { Terrain, OBSTACLE_PRESETS } from '../terrain.ts'
import { Rng } from '../rng.ts'
import { WEAPONS, SECONDARIES, DEFAULT_CONFIG } from '../weapons.ts'
import type { GameConfig } from '../weapons.ts'
import { WORLD_W, WORLD_H, wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist, clamp } from '../wrap.ts'
import { defaultWorldInput } from '../types.ts'
import type { WorldInput, WorldEvent, PlayerState, Projectile, Grenade, Landmine, Airstrike, Obstacle, CapturePoint, AmmoPack, SupplyCrate, Mortar, TeamId } from '../types.ts'
import type { WorldSnapshot } from '../snap.ts'

// ── 玩家碰撞体（v2 checkBodyCollision 的 6 采样点：宽 20 高 ~42）──
const BODY_HALF_W = 10
const BODY_TOP = 26   // 眼位（p.y 是脚底基准）
const BODY_BOTTOM = 16

export const SPAWN_POINTS: { x: number; y: number; team: TeamId }[] = [
  { x: 1100, y: 2740, team: 'red' },
  { x: 12100, y: 2740, team: 'blue' },
  { x: 6600, y: 1460, team: 'green' },
  { x: 6600, y: 2380, team: 'ffa' },
]

export const AMMO_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 1560, y: 2520, area: '西翼大楼二层' },
  { x: 1840, y: 2040, area: '西翼大楼四层' },
  { x: 2620, y: 2260, area: '西区管道内' },
  { x: 3400, y: 2280, area: '西区厂房三层' },
  { x: 4450, y: 2420, area: '中西部管道内' },
  { x: 4760, y: 1430, area: '西部高空平台' },
  { x: 5680, y: 2100, area: '双塔北塔三层' },
  { x: 7250, y: 2100, area: '双塔南塔三层' },
  { x: 6680, y: 1020, area: '中央最高浮岛' },
  { x: 8420, y: 2560, area: '中东部管道内' },
  { x: 8520, y: 1420, area: '中东部高空浮岛' },
  { x: 9540, y: 2520, area: '东区通信大楼' },
  { x: 10120, y: 3520, area: '东区地下掩体' },
  { x: 10380, y: 2340, area: '东区高架管道内' },
  { x: 11360, y: 2520, area: '东翼大楼二层' },
  { x: 12600, y: 2760, area: '极东边境补给点' },
]

const SUPPLY_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 6600, y: 1040, area: '中央最高浮岛' },
  { x: 4150, y: 3520, area: '西区地下战略掩体' },
  { x: 6600, y: 3500, area: '中央地下核心掩体' },
  { x: 10150, y: 3520, area: '东区地下装甲掩体' },
  { x: 2600, y: 1580, area: '西部高空平台' },
  { x: 10550, y: 1580, area: '东部高空平台' },
]

const MORTARS_INIT: Omit<Mortar, 'cooldown' | 'operatorId'>[] = [
  { id: 'mortar_left', name: '西翼高台迫击炮', x: 920, y: 2180, angle: -Math.PI * 0.28, power: 24.0 },
  { id: 'mortar_mid_w', name: '中西浮岛迫击炮', x: 4620, y: 1460, angle: -Math.PI * 0.30, power: 23.0 },
  { id: 'mortar_center', name: '中央天顶迫击炮', x: 6600, y: 1080, angle: -Math.PI * 0.35, power: 24.5 },
  { id: 'mortar_mid_e', name: '中东浮岛迫击炮', x: 8520, y: 1460, angle: -Math.PI * 0.70, power: 23.0 },
  { id: 'mortar_right', name: '东翼高台迫击炮', x: 12260, y: 2180, angle: -Math.PI * 0.72, power: 24.0 },
]

const MINE_PRESETS: { x: number; y: number }[] = [
  { x: 1720, y: 2760 }, { x: 4150, y: 3520 }, { x: 6350, y: 2760 },
  { x: 6850, y: 2760 }, { x: 6600, y: 3500 }, { x: 11420, y: 2760 },
]

const JUMP_PADS: { x: number; y: number; vx: number; vy: number }[] = [
  { x: 1220, y: 2800, vx: 210, vy: -810 },
  { x: 5300, y: 2800, vx: 180, vy: -870 },
  { x: 7880, y: 2800, vx: -180, vy: -870 },
  { x: 11960, y: 2800, vx: -210, vy: -810 },
]

const CP_INITS: { id: string; code: string; name: string; x: number; y: number; ownerTeam: TeamId | null }[] = [
  { id: 'cp_a', code: 'A', name: '据点A·西翼大楼天台', x: 1720, y: 1840, ownerTeam: 'red' },
  { id: 'cp_b', code: 'B', name: '据点B·西区地下掩体', x: 4150, y: 3560, ownerTeam: null },
  { id: 'cp_c', code: 'C', name: '据点C·中央核心大桥', x: 6600, y: 2800, ownerTeam: 'green' },
  { id: 'cp_d', code: 'D', name: '据点D·中央地下地核', x: 6600, y: 3540, ownerTeam: null },
  { id: 'cp_e', code: 'E', name: '据点E·东翼要塞天台', x: 11420, y: 1840, ownerTeam: 'blue' },
]

export class World {
  terrain = new Terrain()
  players: PlayerState[] = []
  projectiles: Projectile[] = []
  grenades: Grenade[] = []
  landmines: Landmine[] = []
  airstrikes: Airstrike[] = []
  obstacles: Obstacle[] = []
  capturePoints: CapturePoint[] = []
  ammoPacks: AmmoPack[] = []
  supplyCrates: SupplyCrate[] = []
  mortars: Mortar[] = []
  scores: Record<string, number> = { red: 0, blue: 0, green: 0, ffa: 0 }
  events: WorldEvent[] = []        // 每 tick 收集，net/ui 层取走（drainEvents）
  config: GameConfig = { ...DEFAULT_CONFIG }
  rng: Rng
  seed: number
  tick = 0
  hits = 0

  private pid = 1
  private prj = 1
  private gren = 1
  private mine = 1
  private air = 1
  private ammo = 1
  private crate = 1
  private spawnIndex = 0
  private ammoSpawnTimer = 0
  private usedAmmoSpots = new Set<number>()

  constructor(seed = 12345) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.terrain.build()
    this.resetMatch()
  }

  /** 全场重置（对局开始/地形重置按钮） */
  resetMatch(): void {
    this.obstacles = OBSTACLE_PRESETS.map(o => ({ ...o, maxHp: o.hp }))
    this.capturePoints = CP_INITS.map(c => ({ ...c, progress: c.ownerTeam ? 100 : 0, capturingTeam: null }))
    this.mortars = MORTARS_INIT.map(m => ({ ...m, cooldown: 0, operatorId: null }))
    this.landmines = MINE_PRESETS.map((m, i) => ({
      id: -(i + 1), owner: 0, pos: { x: m.x, y: m.y }, vel: { x: 0, y: 0 },
      armed: true, armTimer: 0, triggered: false, fuse: 0,
      instant: false, directHit: false, preset: true, respawnTimer: 0,
    }))
    this.supplyCrates = SUPPLY_SPOTS.map((s, idx) => {
      const w = WEAPONS[4 + (idx % 3)]
      return { id: this.crate++, x: s.x, y: s.y, area: s.area, weaponId: w.id, weaponName: w.name, color: w.color, active: true, respawnTimer: 0 }
    })
    this.ammoPacks = []
    this.usedAmmoSpots.clear()
    for (let i = 0; i < this.config.ammoPackMaxActive; i++) this.spawnAmmoPack()
    this.projectiles = []
    this.grenades = []
    this.airstrikes = []
    this.ammoSpawnTimer = 0
    this.scores = { red: 0, blue: 0, green: 0, ffa: 0 }
  }

  // ── 玩家管理 ──────────────────────────────────────────────
  addPlayer(name = 'Player', team: TeamId = 'ffa'): PlayerState {
    const p: PlayerState = {
      id: this.pid++,
      pos: { x: 6600, y: 2380 }, vel: { x: 0, y: 0 },
      aim: 0, team, name,
      hp: this.config.maxHp, maxHp: this.config.maxHp,
      alive: true, deployed: true, onGround: true,
      weaponIndex: 1,
      ammo: WEAPONS.map(w => w.magSize),
      reserveAmmo: WEAPONS.map(w => w.maxReserve),
      reloading: false, reloadTimer: 0, fireCooldown: 0,
      secondary: 'frag', secondaryCooldown: 0,
      pistolAmmo: 12, pistolReserve: 48,
      jetpack: false, fuel: getPhysicsParams().jetpackFuel,
      shieldHp: 0, shieldTimer: 0, watchtowerTimer: 0,
      doll: null, respawnTimer: 0,
      kills: 0, deaths: 0,
    }
    this.respawnAt(p, team)
    this.players.push(p)
    return p
  }

  /** 出生点：按队伍；优先已占领点（占点重生机制） */
  private respawnAt(p: PlayerState, team: TeamId): void {
    const owned = this.capturePoints.filter(c => c.ownerTeam === team && c.progress >= 100)
    const cp = owned.length > 0 ? owned[this.rng.int(owned.length)] : null
    const base = SPAWN_POINTS.find(s => s.team === team) ?? SPAWN_POINTS[3]
    const sx = cp ? cp.x : base.x
    const sy = cp ? cp.y - 60 : base.y
    p.pos = { x: wrapX(sx + this.rng.range(-45, 45)), y: sy }
    p.vel = { x: 0, y: 0 }
    p.hp = this.config.maxHp
    p.ammo = WEAPONS.map(w => w.magSize)
    p.reserveAmmo = WEAPONS.map(w => w.maxReserve)
    p.pistolAmmo = 12
    p.pistolReserve = 48
    p.fuel = getPhysicsParams().jetpackFuel
    p.shieldHp = 0
    p.shieldTimer = 0
    p.watchtowerTimer = 0
    p.doll = null
    p.reloading = false
    p.fireCooldown = 0
    p.secondaryCooldown = 0
    p.deployed = true
    p.alive = true
  }

  // ── 主 step ──────────────────────────────────────────────
  step(dt: number, inputs: Map<number, WorldInput>): void {
    this.tick++
    this.events.length = 0

    for (const p of this.players) {
      const w = inputs.get(p.id) ?? defaultWorldInput()
      this.apply(p, w, dt)
      if (p.deployed) this.physics(p, dt)
    }

    this.stepProjectiles(dt)
    this.stepGrenades(dt)
    this.stepLandmines(dt)
    this.stepAirstrikes(dt)
    this.stepObstaclesOnly()      // 无：障碍物 hp 在命中时结算，无每帧推进
    this.stepCapturePoints(dt)
    this.stepMortars(dt)
    this.stepSupplyCrates(dt)
    this.tickAmmoSpawner(dt)
    this.projectiles = this.projectiles.filter(pr => pr.life > 0)
    this.grenades = this.grenades.filter(g => g.fuse > 0)
  }

  drainEvents(): WorldEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  // ── 输入应用（武器/副武器/交互） ────────────────────────────
  private apply(p: PlayerState, w: WorldInput, dt: number): void {
    if (!p.deployed) return
    // 重生等待
    if (p.respawnTimer > 0) {
      p.respawnTimer -= dt
      if (p.respawnTimer <= 0) this.respawnAt(p, p.team)
      return
    }
    if (!p.alive) return

    // 换枪（v2 配装锁定：部署后不可换，仅重生等待期可换）
    if (w.switchWeapon !== null && w.switchWeapon !== p.weaponIndex) {
      const wep = WEAPONS[w.switchWeapon]
      const canSwitch = !this.config.loadoutLock || p.respawnTimer > 0 || !p.deployed
      if (wep && !wep.isSupplyOnly && canSwitch) {
        p.weaponIndex = wep.id
        p.reloading = false
        p.fireCooldown = Math.max(p.fireCooldown, 0.3)
      }
    }

    p.aim = w.aim
    move(p.vel, w.move)
    if (w.jump && this.onGround(p)) jump(p.vel)
    const fuel = p.fuel
    const canJet = w.jetpack && fuel > 0
    if (canJet) jetpack(p.vel, dt)
    p.jetpack = canJet
    p.fuel = updateJetpackFuel(fuel, w.jetpack, dt)

    // 冷却推进
    if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt)
    if (p.secondaryCooldown > 0) p.secondaryCooldown = Math.max(0, p.secondaryCooldown - dt)
    if (p.shieldTimer > 0) {
      p.shieldTimer -= dt
      if (p.shieldTimer <= 0) { p.shieldTimer = 0; p.shieldHp = 0 }
    }
    if (p.watchtowerTimer > 0) p.watchtowerTimer = Math.max(0, p.watchtowerTimer - dt)

    // 换弹结算
    if (p.reloading) {
      p.reloadTimer -= dt
      if (p.reloadTimer <= 0) {
        p.reloading = false
        const wep = WEAPONS[p.weaponIndex]
        const needed = wep.magSize - p.ammo[p.weaponIndex]
        const avail = p.reserveAmmo[p.weaponIndex] || 0
        const transfer = Math.min(needed, avail)
        p.ammo[p.weaponIndex] += transfer
        p.reserveAmmo[p.weaponIndex] = avail - transfer
      }
    }
    if (w.reload) this.startReload(p)

    // 替身人偶倒计时（到期自动回溯）
    if (p.doll) {
      p.doll.timer -= dt
      if (p.doll.timer <= 0) this.recallDoll(p, 'doll_recall')
    }

    // 交互（E）：瞭望塔 / 迫击炮
    if (w.interact) this.interact(p)

    // 副武器（瞬时意图）
    if (w.secondary) this.useSecondary(p, w.secondary, dt)

    // 开火
    if (w.fire) this.fire(p)
  }

  // ── 开火 ──────────────────────────────────────────────
  private fire(p: PlayerState): void {
    if (p.respawnTimer > 0 || !p.alive) return
    // 迫击炮操控中
    const m = this.mortars.find(mm => mm.operatorId === p.id)
    if (m) {
      if (m.cooldown <= 0) {
        m.cooldown = this.config.mortarCooldown
        this.projectiles.push(this.makeProjectile(p, m.x + Math.cos(m.angle) * 34, m.y - 18 + Math.sin(m.angle) * 34,
          Math.cos(m.angle) * m.power * 60, Math.sin(m.angle) * m.power * 60,
          { damage: this.config.mortarDamage, headshotMult: 1.5, terrainRadius: this.config.mortarRadius, explosive: true, gravityScale: 0.68, weaponLabel: '公共迫击炮', color: '#f97316', r: 7.5, life: 175 / 60 }))
        this.events.push({ kind: 'mortar_fire', x: m.x, y: m.y, playerId: p.id })
      }
      return
    }
    const wep = WEAPONS[p.weaponIndex]
    if (p.reloading || p.fireCooldown > 0) return
    if (p.ammo[p.weaponIndex] <= 0) {
      if ((p.reserveAmmo[p.weaponIndex] || 0) > 0) this.startReload(p)
      return
    }
    p.ammo[p.weaponIndex]--
    p.fireCooldown = wep.fireDelay
    if (p.ammo[p.weaponIndex] <= 0 && (p.reserveAmmo[p.weaponIndex] || 0) > 0) this.startReload(p)

    // 后坐力（v2 recoil×0.56/0.65）
    if (wep.recoil > 0) {
      p.vel.x -= Math.cos(p.aim) * wep.recoil * 0.56
      p.vel.y -= Math.sin(p.aim) * wep.recoil * 0.65
    }

    const mx = wrapX(p.pos.x + Math.cos(p.aim) * 24)
    const my = (p.pos.y - 12) + Math.sin(p.aim) * 24
    for (let i = 0; i < wep.pellets; i++) {
      const spreadA = p.aim + this.rng.range(-wep.spread / 2, wep.spread / 2)
      const spd = wep.speed * (wep.pellets > 1 ? this.rng.range(0.88, 1.12) : 1)
      this.projectiles.push(this.makeProjectile(p, mx, my, Math.cos(spreadA) * spd, Math.sin(spreadA) * spd, {
        damage: wep.damage, headshotMult: wep.headshotMult, terrainRadius: wep.terrainRadius,
        explosive: wep.explosive, gravityScale: wep.gravityScale ?? (wep.id === 4 ? 0.0 : 0.04),
        pierceOnHeadshot: !!wep.pierceOnHeadshot, pierceAll: !!wep.pierceAll,
        isGravityOrb: !!wep.isGravityOrb, weaponLabel: wep.shortName, color: wep.color,
        r: wep.isGravityOrb ? 8.5 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2,
        life: (wep.id === 2 || wep.id === 4 ? 175 : 130) / 60,
      }))
    }
  }

  private makeProjectile(p: PlayerState, x: number, y: number, vx: number, vy: number, o: {
    damage: number; headshotMult: number; terrainRadius: number; explosive: boolean; gravityScale?: number;
    pierceOnHeadshot?: boolean; pierceAll?: boolean; isGravityOrb?: boolean; weaponLabel: string; color: string; r: number; life: number
  }): Projectile {
    return {
      id: this.prj++, owner: p.id, pos: { x: wrapX(x), y: wrapY(y) }, vel: { x: vx, y: vy },
      life: o.life, r: o.r, damage: o.damage, headshotMult: o.headshotMult,
      explosive: o.explosive, terrainRadius: o.terrainRadius, gravityScale: o.gravityScale ?? 0.04,
      pierceOnHeadshot: !!o.pierceOnHeadshot, pierceAll: !!o.pierceAll,
      isGravityOrb: !!o.isGravityOrb, weaponLabel: o.weaponLabel, color: o.color,
      hitTargets: [p.id],   // 发射者自身永远跳过
    }
  }

  private startReload(p: PlayerState): void {
    const wep = WEAPONS[p.weaponIndex]
    if (!wep || p.reloading || p.ammo[p.weaponIndex] >= wep.magSize) return
    if ((p.reserveAmmo[p.weaponIndex] || 0) <= 0) return
    p.reloading = true
    p.reloadTimer = wep.reloadTime
  }

  // ── 副武器（8 种，v2 逻辑移植；全部服务器权威结算） ──────────────
  private useSecondary(p: PlayerState, s: { type: string; targetX: number; targetY: number }, _dt: number): void {
    if (p.respawnTimer > 0 || p.secondaryCooldown > 0 || !p.alive) return
    const def = SECONDARIES[s.type]
    if (!def) return
    const tx = wrapX(s.targetX)
    const ty = s.targetY

    if (s.type === 'pistol') {
      if (p.pistolAmmo <= 0) {
        if (p.pistolReserve > 0) {
          const load = Math.min(12, p.pistolReserve)
          p.pistolAmmo = load
          p.pistolReserve -= load
          p.secondaryCooldown = 1.0
        }
        return
      }
      p.pistolAmmo--
      p.secondaryCooldown = def.cd
      const mx = wrapX(p.pos.x + Math.cos(p.aim) * 22)
      const my = (p.pos.y - 12) + Math.sin(p.aim) * 22
      this.projectiles.push(this.makeProjectile(p, mx, my, Math.cos(p.aim) * 1380, Math.sin(p.aim) * 1380, {
        damage: this.config.pistolDamage, headshotMult: this.config.pistolHeadshotMult, terrainRadius: 6,
        explosive: false, gravityScale: 0.03, weaponLabel: '战术手枪', color: '#fde047', r: 3.2, life: 105 / 60,
      }))
      return
    }

    p.secondaryCooldown = def.cd

    if (s.type === 'doll') {
      p.doll = {
        pos: { x: p.pos.x, y: p.pos.y }, hp: p.hp, shieldHp: p.shieldHp, fuel: p.fuel,
        weaponIndex: p.weaponIndex, ammo: [...p.ammo], reserveAmmo: [...p.reserveAmmo],
        timer: this.config.dollDuration,
      }
      this.events.push({ kind: 'doll_recall', x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: 'anchor' })
      return
    }
    if (s.type === 'shield') {
      p.shieldHp = this.config.shieldHp
      p.shieldTimer = this.config.shieldDuration
      return
    }
    if (s.type === 'barricade') {
      const bx = wrapX(Math.round(p.pos.x + Math.cos(p.aim) * 66 - 22))
      const by = wrapY(Math.round(p.pos.y - 44))
      this.obstacles.push({
        id: `obs_p_${p.id}_${this.tick}`, x: bx, y: by, w: 44, h: 88,
        hp: this.config.obstacleDefaultHp, maxHp: this.config.obstacleDefaultHp,
        label: `${p.name}的掩体`, color: '#0f766e', borderColor: '#2dd4bf',
      })
      return
    }
    if (s.type === 'airstrike') {
      this.airstrikes.push({ id: this.air++, owner: p.id, pos: { x: tx, y: ty }, timer: 1.05, dropped: false })
      return
    }
    if (s.type === 'mine' || s.type === 'instant_mine') {
      const isInstant = s.type === 'instant_mine'
      const throwSpd = isInstant ? 570 : 480
      this.landmines.push({
        id: this.mine++, owner: p.id,
        pos: { x: wrapX(p.pos.x + Math.cos(p.aim) * 26), y: p.pos.y - 10 + Math.sin(p.aim) * 18 },
        vel: { x: Math.cos(p.aim) * throwSpd, y: Math.sin(p.aim) * throwSpd - 132 },
        armed: false, armTimer: isInstant ? 0.25 : 0.75, triggered: false, fuse: 0,
        instant: isInstant, directHit: true, preset: false, respawnTimer: 0,
      })
      return
    }
    // frag 手榴弹
    const throwSpeed = 810
    this.grenades.push({
      id: this.gren++, owner: p.id,
      pos: { x: wrapX(p.pos.x + Math.cos(p.aim) * 20), y: p.pos.y - 16 + Math.sin(p.aim) * 20 },
      vel: { x: Math.cos(p.aim) * throwSpeed + p.vel.x * 0.25, y: Math.sin(p.aim) * throwSpeed - 96 + p.vel.y * 0.2 },
      fuse: this.config.grenadeFuse, bounces: 0,
    })
  }

  /** 替身人偶回溯（死亡触发 或 10s 到期触发） */
  private recallDoll(p: PlayerState, ev: 'doll_recall'): void {
    if (!p.doll) return
    const d = p.doll
    p.doll = null
    p.pos = { x: wrapX(d.pos.x), y: d.pos.y }
    p.vel = { x: 0, y: 0 }
    p.hp = Math.max(1, d.hp)
    p.shieldHp = d.shieldHp
    p.fuel = d.fuel
    p.weaponIndex = d.weaponIndex
    p.ammo = [...d.ammo]
    p.reserveAmmo = [...d.reserveAmmo]
    p.respawnTimer = 0
    p.alive = true
    this.events.push({ kind: 'doll_recall', x: p.pos.x, y: p.pos.y, playerId: p.id })
  }

  // ── 交互（E 键） ──────────────────────────────────────────
  private interact(p: PlayerState): void {
    if (p.respawnTimer > 0 || !p.alive) return
    // 退出迫击炮
    const cur = this.mortars.find(m => m.operatorId === p.id)
    if (cur) {
      cur.operatorId = null
      p.vel.y = -270
      return
    }
    // 上迫击炮
    for (const m of this.mortars) {
      if (m.operatorId === null && wrapDist(p.pos.x, p.pos.y, m.x, m.y) < 115) {
        m.operatorId = p.id
        p.pos = { x: m.x, y: m.y - 16 }
        p.vel = { x: 0, y: 0 }
        return
      }
    }
  }

  // ── 物理 ──────────────────────────────────────────────
  private physics(p: PlayerState, dt: number): void {
    if (!p.alive || p.respawnTimer > 0) return
    // 迫击炮操控中：吸附在炮位
    const m = this.mortars.find(mm => mm.operatorId === p.id)
    if (m) {
      p.pos = { x: m.x, y: m.y - 16 }
      p.vel = { x: 0, y: 0 }
      return
    }
    applyGravity(p.vel, dt)
    // 不用 integrate()：移动由下面的试探-回退碰撞统一控制（v2 模式），避免双重积分

    // 弹射跳台
    for (const pad of JUMP_PADS) {
      if (wrapDist(p.pos.x, p.pos.y, pad.x, pad.y) < 42 && p.vel.y >= -120) {
        p.vel.x += pad.vx
        p.vel.y = pad.vy
      }
    }

    // 身体碰撞（6 采样点，v2 checkBodyCollision）
    const hitBody = (x: number, y: number): boolean => {
      const wx = wrapX(x)
      if (this.terrain.isSolidAt(wx, y)) return true
      return this.obstacleAt(wx, y) !== null
    }
    const pts = (cx: number, cy: number): boolean =>
      hitBody(cx - BODY_HALF_W, cy + BODY_BOTTOM) || hitBody(cx + BODY_HALF_W, cy + BODY_BOTTOM) ||
      hitBody(cx, cy + BODY_BOTTOM) || hitBody(cx - BODY_HALF_W, cy) ||
      hitBody(cx + BODY_HALF_W, cy) || hitBody(cx, cy - BODY_TOP)

    const nx = wrapX(p.pos.x + p.vel.x * dt)
    if (!pts(nx, p.pos.y)) p.pos.x = nx
    else if (!pts(nx, p.pos.y - 10)) { p.pos.x = nx; p.pos.y -= 10 }   // 自动上台阶
    else p.vel.x *= -0.2

    const nyRaw = p.pos.y + p.vel.y * dt
    const ny = wrapY(nyRaw)
    if (!pts(p.pos.x, ny)) {
      p.pos.y = ny
      p.onGround = false
    } else {
      p.onGround = p.vel.y > 0
      p.vel.y = 0
    }
    p.pos.x = wrapX(p.pos.x)
    p.pos.y = wrapY(p.pos.y)
  }

  private onGround(p: PlayerState): boolean {
    return !!p.onGround
  }

  // ── 弹道 ──────────────────────────────────────────────
  private stepProjectiles(dt: number): void {
    const g = 1250   // physics.gravity（骨架调优值）
    for (const pr of this.projectiles) {
      if (pr.life <= 0) continue
      // 引力枪飞行途中牵引敌人
      if (pr.isGravityOrb) {
        for (const t of this.players) {
          if (t.respawnTimer > 0 || !t.deployed || !t.alive || pr.hitTargets.includes(t.id)) continue
          const dx = wrapDeltaX(t.pos.x, pr.pos.x)
          const dy = wrapDeltaY(t.pos.y - 12, pr.pos.y)
          const d = Math.hypot(dx, dy)
          if (d < 190 && d > 8) {
            const pull = (1 - d / 190) * 620 * dt
            t.vel.x += (dx / d) * pull
            t.vel.y -= (dy / d) * pull
          }
        }
      }
      pr.vel.y += g * pr.gravityScale * dt
      pr.pos.x = wrapX(pr.pos.x + pr.vel.x * dt)
      pr.pos.y = wrapY(pr.pos.y + pr.vel.y * dt)
      pr.life -= dt
      if (pr.life <= 0) continue

      let hit = false
      // A. 玩家（头/躯干，爆头穿透）
      for (const t of this.players) {
        if (t.respawnTimer > 0 || !t.deployed || !t.alive || pr.hitTargets.includes(t.id)) continue
        if (t.id !== pr.owner && t.team === this.ownerTeamOf(pr.owner) && t.team !== 'ffa') continue
        const dxHead = wrapDeltaX(t.pos.x, pr.pos.x)
        const dyHead = wrapDeltaY(t.pos.y - 24, pr.pos.y)
        if (Math.hypot(dxHead, dyHead) <= this.config.headRadius + pr.r) {
          pr.hitTargets.push(t.id)
          const piercing = pr.pierceOnHeadshot || pr.pierceAll
          if (pr.explosive) {
            this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage * pr.headshotMult, 960, pr)
            hit = true
          } else {
            this.damage(t, Math.round(pr.damage * pr.headshotMult), pr, true, piercing)
            t.vel.x += pr.vel.x * 0.12
            t.vel.y += pr.vel.y * 0.12 - 72
            if (!piercing) hit = true
          }
          if (hit) break
          continue
        }
        const dxBody = Math.abs(wrapDeltaX(t.pos.x, pr.pos.x))
        const dyBody = wrapDeltaY(t.pos.y, pr.pos.y)
        if (dxBody <= 13 + pr.r && dyBody >= -12 && dyBody <= 18) {
          pr.hitTargets.push(t.id)
          if (pr.explosive) {
            this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 900, pr)
            hit = true
          } else {
            this.damage(t, Math.round(pr.damage), pr, false, false)
            t.vel.x += pr.vel.x * 0.09
            t.vel.y += pr.vel.y * 0.09
            if (!pr.pierceAll) hit = true
          }
          if (hit) break
        }
      }
      if (hit) { pr.life = 0; continue }

      // B. 可破坏障碍物
      const ob = this.obstacleAt(pr.pos.x, pr.pos.y, pr.r)
      if (ob) {
        if (pr.explosive) {
          this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr)
          hit = true
        } else {
          this.damageObstacle(ob, pr.damage, pr)
          if (!pr.pierceAll) hit = true
        }
        if (hit) { pr.life = 0; continue }
      }

      // C. 原始地形
      if (this.terrain.isSolidAt(pr.pos.x, pr.pos.y)) {
        if (pr.explosive) this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr)
        pr.life = 0
        continue
      }
    }
  }

  private ownerTeamOf(id: number): TeamId {
    return this.players.find(p => p.id === id)?.team ?? 'ffa'
  }

  // ── 爆炸（对障碍物/玩家/含引力内爆） ──────────────────────
  private explode(cx: number, cy: number, radius: number, maxDamage: number, knockback: number, pr?: Projectile, ownerId?: number, ownerTeam?: TeamId, weaponLabel?: string, implosion = false): void {
    const wCx = wrapX(cx)
    this.events.push({ kind: 'explosion', x: wCx, y: cy, radius })
    // 障碍物
    for (const ob of [...this.obstacles]) {
      const dx = wrapDeltaX(wCx, ob.x + ob.w / 2)
      const dOb = wrapDeltaY(ob.y, cy)               // 障碍物中心带内的垂直距离
      const nearY = clamp(dOb, 0, ob.h)
      const dist = Math.hypot(Math.max(0, Math.abs(dx) - ob.w / 2), dOb - nearY)
      if (dist <= radius * 1.25) this.damageObstacle(ob, maxDamage * (1 - dist / (radius * 1.25)) + 30, pr)
    }
    // 玩家
    const hitR = radius * 1.35
    const atkId = ownerId ?? pr?.owner ?? 0
    const atkTeam = ownerTeam ?? this.ownerTeamOf(atkId)
    const label = weaponLabel ?? pr?.weaponLabel ?? '爆炸'
    for (const t of this.players) {
      if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue
      const dx = wrapDeltaX(wCx, t.pos.x)
      const dy = wrapDeltaY(cy, t.pos.y - 12)
      const dist = Math.hypot(dx, dy)
      if (dist > hitR) continue
      const falloff = Math.max(0.2, 1 - dist / hitR)
      const nx = dist > 0.1 ? dx / dist : 0
      const ny = dist > 0.1 ? dy / dist : -1
      const sign = implosion ? -0.85 : 1.0
      t.vel.x += nx * knockback * falloff * sign
      t.vel.y += (ny * knockback - 210) * falloff * sign
      const isSelf = t.id === atkId
      const isTeammate = !isSelf && t.team === atkTeam && t.team !== 'ffa'
      if (!isTeammate) {
        const dmg = Math.round(maxDamage * falloff * (isSelf ? 0.25 : 1))
        const headDist = Math.hypot(dx, wrapDeltaY(cy, t.pos.y - 26))
        const isHead = headDist < this.config.headRadius * 1.6 && dist < radius * 0.6
        this.damage(t, isHead ? Math.round(dmg * 1.35) : dmg, pr, isHead, false, atkId, atkTeam, label)
      }
    }
  }

  private damage(t: PlayerState, amount: number, pr: Projectile | undefined, isHead: boolean, isPierced: boolean, attackerId?: number, attackerTeam?: TeamId, weaponLabel?: string): void {
    if (t.respawnTimer > 0 || !t.deployed || amount <= 0) return
    const atkId = attackerId ?? pr?.owner ?? 0
    const atkTeam = attackerTeam ?? this.ownerTeamOf(atkId)
    const label = weaponLabel ?? pr?.weaponLabel ?? '未知'
    let remaining = amount
    if (t.shieldTimer > 0 && t.shieldHp > 0) {
      const absorbed = Math.min(t.shieldHp, remaining)
      t.shieldHp -= absorbed
      remaining -= absorbed
      if (t.shieldHp <= 0) {
        t.shieldHp = 0
        t.shieldTimer = 0
        this.events.push({ kind: 'shield_break', x: t.pos.x, y: t.pos.y, playerId: t.id })
      }
      if (remaining <= 0) return
    }
    t.hp -= remaining
    if (isHead) this.events.push({ kind: 'headshot', x: t.pos.x, y: t.pos.y, victimId: t.id, playerId: atkId, isPierced })
    this.hits++
    if (t.hp > 0) return

    // 致死：替身人偶优先
    if (t.doll && t.doll.timer > 0) {
      this.recallDoll(t, 'doll_recall')
      return
    }
    t.hp = 0
    t.deaths++
    t.respawnTimer = this.config.respawnDelay
    t.shieldHp = 0
    t.shieldTimer = 0
    t.watchtowerTimer = 0
    const mk = this.mortars.find(m => m.operatorId === t.id)
    if (mk) mk.operatorId = null
    const killer = this.players.find(x => x.id === atkId)
    if (killer && atkId !== t.id) {
      killer.kills++
      if (this.scores[atkTeam] !== undefined) this.scores[atkTeam]++
    }
    this.events.push({
      kind: 'kill', killerId: atkId, victimId: t.id,
      killerName: killer?.name ?? '战场环境', killerTeam: atkTeam,
      victimName: t.name, victimTeam: t.team,
      weaponLabel: label, isHeadshot: isHead, isPierced,
      x: t.pos.x, y: t.pos.y,
    })
  }

  private damageObstacle(ob: Obstacle, dmg: number, pr?: Projectile): void {
    if (ob.hp <= 0 || dmg <= 0) return
    ob.hp = Math.max(0, ob.hp - Math.round(dmg))
    if (ob.hp <= 0) {
      this.obstacles = this.obstacles.filter(o => o.id !== ob.id)
      this.events.push({ kind: 'obstacle_destroy', obstacleId: ob.id, x: ob.x, y: ob.y })
    }
  }

  private obstacleAt(x: number, y: number, pad = 0): Obstacle | null {
    const wx = wrapX(x)
    for (const ob of this.obstacles) {
      if (ob.hp <= 0) continue
      const dy = wrapDeltaY(ob.y, y)               // 垂直跨缝：中心距判定
      if (wx >= ob.x - pad && wx <= ob.x + ob.w + pad && dy >= -pad && dy <= ob.h + pad) return ob
    }
    return null
  }

  // ── 手雷 ──────────────────────────────────────────────
  private stepGrenades(dt: number): void {
    const g0 = 1250
    for (const g of this.grenades) {
      g.vel.y += g0 * 0.88 * dt
      g.vel.x *= 0.99
      const nx = wrapX(g.pos.x + g.vel.x * dt)
      if (this.terrain.isSolidAt(nx, g.pos.y) || this.obstacleAt(nx, g.pos.y)) g.vel.x *= -0.35
      else g.pos.x = nx
      const ny = g.pos.y + g.vel.y * dt
      if (this.terrain.isSolidAt(g.pos.x, ny) || this.obstacleAt(g.pos.x, ny)) {
        g.vel.y *= -0.28
        g.vel.x *= 0.42
        if (Math.abs(g.vel.y) < 81) {
          g.vel.y = 0
          g.vel.x *= 0.60
          if (Math.abs(g.vel.x) < 11) g.vel.x = 0
        }
      } else g.pos.y = wrapY(ny)
      g.fuse -= dt
      if (g.fuse <= 0) {
        this.explode(g.pos.x, g.pos.y, this.config.grenadeRadius, this.config.grenadeDamage, 16 * 60, undefined, g.owner, undefined, '手榴弹')
        g.fuse = 0
      }
    }
  }

  // ── 地雷（受重力 + 直击 + 瞬发 + 定时必爆 + 预设重生） ──────────
  private stepLandmines(dt: number): void {
    const g0 = 1250
    for (let i = this.landmines.length - 1; i >= 0; i--) {
      const m = this.landmines[i]
      if (m.respawnTimer > 0) {
        m.respawnTimer -= dt
        if (m.respawnTimer <= 0) { m.armed = true; m.triggered = false; m.fuse = 0; m.vel = { x: 0, y: 0 } }
        continue
      }
      // 重力
      if (!this.terrain.isSolidAt(m.pos.x, m.pos.y + 8) && !this.obstacleAt(m.pos.x, m.pos.y + 8)) {
        m.vel.y += g0 * 0.86 * dt
        const nx = wrapX(m.pos.x + m.vel.x * dt)
        if (!this.terrain.isSolidAt(nx, m.pos.y) && !this.obstacleAt(nx, m.pos.y)) m.pos.x = nx
        else m.vel.x = -(m.vel.x) * 0.35
        const ny = m.pos.y + m.vel.y * dt
        if (!this.terrain.isSolidAt(m.pos.x, ny + 8) && !this.obstacleAt(m.pos.x, ny + 8)) m.pos.y = wrapY(ny)
        else { m.vel.y = 0; m.vel.x *= 0.35; if (Math.abs(m.vel.x) < 12) m.vel.x = 0 }
      } else {
        m.vel.y = 0
        m.vel.x *= 0.5
        if (Math.abs(m.vel.x) < 12) m.vel.x = 0
      }
      // 直击触发
      if (m.directHit && !m.triggered) {
        for (const t of this.players) {
          if (t.respawnTimer > 0 || !t.deployed || !t.alive || t.id === m.owner) continue
          if (t.team === this.ownerTeamOf(m.owner) && t.team !== 'ffa') continue
          if (wrapDist(m.pos.x, m.pos.y, t.pos.x, t.pos.y - 10) <= 26) { m.triggered = true; m.fuse = 0.01; break }
        }
      }
      if (!m.armed && !m.triggered) {
        m.armTimer -= dt
        if (m.armTimer <= 0) m.armed = true
        continue
      }
      if (!m.triggered) {
        for (const t of this.players) {
          if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue
          if (!m.preset && t.id === m.owner) continue
          if (wrapDist(t.pos.x, t.pos.y, m.pos.x, m.pos.y) <= this.config.mineTriggerRadius) {
            m.triggered = true
            m.fuse = m.instant ? 0.02 : 0.45
            break
          }
        }
      } else {
        m.fuse -= dt
        if (m.fuse <= 0) {
          const label = m.instant ? '⚡瞬发地雷' : '🚨感应地雷'
          const ownTeam = m.owner === 0 ? 'ffa' : this.ownerTeamOf(m.owner)
          this.explode(m.pos.x, m.pos.y, 82, this.config.mineDamage, 19 * 60, undefined, m.owner === 0 ? undefined : m.owner, undefined, label)
          if (m.preset) m.respawnTimer = this.config.mineRespawnTime
          else this.landmines.splice(i, 1)
        }
      }
    }
  }

  // ── 空袭 ──────────────────────────────────────────────
  private stepAirstrikes(dt: number): void {
    for (let i = this.airstrikes.length - 1; i >= 0; i--) {
      const st = this.airstrikes[i]
      st.timer -= dt
      if (st.timer <= 0 && !st.dropped) {
        st.dropped = true
        this.events.push({ kind: 'airstrike_drop', x: st.pos.x, y: st.pos.y })
        const src = this.players.find(p => p.id === st.owner)
        for (let b = -2; b <= 2; b++) {
          this.projectiles.push(this.makeProjectile(
            src ?? ({ id: st.owner, pos: st.pos, vel: { x: 0, y: 0 }, aim: 0, team: 'ffa', name: '空袭' } as unknown as PlayerState),
            st.pos.x + b * 44, st.pos.y - 420 - Math.abs(b) * 28,
            this.rng.range(-30, 30), 900 + this.rng.range(0, 120), {
              damage: this.config.airstrikeDamage, headshotMult: 1.5, terrainRadius: this.config.airstrikeRadius,
              explosive: true, gravityScale: 0.5, weaponLabel: '✈️定点空袭', color: '#f43f5e', r: 7, life: 160 / 60,
            }))
        }
      }
      if (st.timer <= -0.6) this.airstrikes.splice(i, 1)
    }
  }

  // ── 占点 ──────────────────────────────────────────────
  private stepCapturePoints(dt: number): void {
    for (const cp of this.capturePoints) {
      const presence: Partial<Record<TeamId, number>> = {}
      for (const p of this.players) {
        if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue
        if (wrapDist(p.pos.x, p.pos.y, cp.x, cp.y) < this.config.captureRadius) {
          presence[p.team] = (presence[p.team] || 0) + 1
        }
      }
      const teams = Object.keys(presence) as TeamId[]
      if (teams.length === 1) {
        const t = teams[0]
        if (cp.ownerTeam !== t) {
          cp.capturingTeam = t
          cp.progress += this.config.captureRate * dt * (presence[t] || 0)
          if (cp.progress >= 100) {
            cp.progress = 100
            cp.ownerTeam = t
            this.events.push({ kind: 'capture', pointCode: cp.code, team: t, x: cp.x, y: cp.y })
          }
        }
      }
    }
  }

  // ── 迫击炮冷却 ──────────────────────────────────────────
  private stepMortars(dt: number): void {
    for (const m of this.mortars) {
      if (m.cooldown > 0) m.cooldown = Math.max(0, m.cooldown - dt)
    }
  }

  // ── 补给箱 ──────────────────────────────────────────────
  private stepSupplyCrates(dt: number): void {
    for (const crate of this.supplyCrates) {
      if (!crate.active && crate.respawnTimer > 0) {
        crate.respawnTimer -= dt
        if (crate.respawnTimer <= 0) crate.active = true
      }
      if (!crate.active) continue
      for (const p of this.players) {
        if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue
        if (wrapDist(p.pos.x, p.pos.y, crate.x, crate.y) < 44) {
          crate.active = false
          crate.respawnTimer = this.config.supplyRespawnTime
          p.weaponIndex = crate.weaponId
          p.ammo[crate.weaponId] = WEAPONS[crate.weaponId].magSize
          p.reserveAmmo[crate.weaponId] = WEAPONS[crate.weaponId].maxReserve
          this.events.push({ kind: 'supply_pickup', playerId: p.id, weaponName: crate.weaponName, x: crate.x, y: crate.y })
          break
        }
      }
    }
  }

  // ── 弹药点（随机刷新走 Rng） ──────────────────────────────
  private spawnAmmoPack(): void {
    if (this.ammoPacks.length >= this.config.ammoPackMaxActive) return
    const available: number[] = []
    for (let i = 0; i < AMMO_SPOTS.length; i++) {
      if (!this.ammoPacks.some(a => a.x === AMMO_SPOTS[i].x)) available.push(i)
    }
    if (available.length === 0) return
    const spot = AMMO_SPOTS[this.rng.pick(available)]
    this.ammoPacks.push({ id: this.ammo++, x: spot.x, y: spot.y, area: spot.area })
  }

  private tickAmmoSpawner(dt: number): void {
    this.ammoSpawnTimer += dt
    if (this.ammoSpawnTimer >= this.config.ammoPackInterval) {
      this.ammoSpawnTimer = 0
      this.spawnAmmoPack()
    }
    // 拾取
    for (let i = this.ammoPacks.length - 1; i >= 0; i--) {
      const pack = this.ammoPacks[i]
      for (const p of this.players) {
        if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue
        if (wrapDist(p.pos.x, p.pos.y, pack.x, pack.y) < 44) {
          const wep = WEAPONS[p.weaponIndex]
          p.reserveAmmo[p.weaponIndex] = Math.min(wep.maxReserve * 2, (p.reserveAmmo[p.weaponIndex] || 0) + wep.maxReserve)
          p.pistolReserve = Math.min(96, p.pistolReserve + 24)
          this.ammoPacks.splice(i, 1)
          this.events.push({ kind: 'ammo_pickup', playerId: p.id, x: pack.x, y: pack.y })
          break
        }
      }
    }
  }

  private stepObstaclesOnly(): void { /* 障碍物无每帧推进（hp 在命中时结算） */ }

  // ── 快照 ──────────────────────────────────────────────
  snapshot(): WorldSnapshot {
    return {
      tick: this.tick,
      seed: this.seed,
      players: this.players.map(p => ({
        ...p,
        pos: { ...p.pos }, vel: { ...p.vel },
        ammo: [...p.ammo], reserveAmmo: [...p.reserveAmmo],
        doll: p.doll ? { ...p.doll, pos: { ...p.doll.pos }, ammo: [...p.doll.ammo], reserveAmmo: [...p.doll.reserveAmmo] } : null,
      })),
      projectiles: this.projectiles.map(pr => ({ ...pr, pos: { ...pr.pos }, vel: { ...pr.vel }, hitTargets: [...pr.hitTargets] })),
      grenades: this.grenades.map(g => ({ ...g, pos: { ...g.pos }, vel: { ...g.vel } })),
      landmines: this.landmines.map(m => ({ ...m, pos: { ...m.pos }, vel: { ...m.vel } })),
      airstrikes: this.airstrikes.map(a => ({ ...a, pos: { ...a.pos } })),
      obstacles: this.obstacles.map(o => ({ ...o })),
      capturePoints: this.capturePoints.map(c => ({ ...c })),
      ammoPacks: this.ammoPacks.map(a => ({ ...a })),
      supplyCrates: this.supplyCrates.map(c => ({ ...c })),
      mortars: this.mortars.map(m => ({ ...m })),
      scores: { ...this.scores },
    }
  }
}

// 兼容旧接口（tests/main.ts 引用）
export const GROUND_Y = 540
