// core/sim/world.ts —— 服务器权威世界模拟（确定性，零 IO，可在服务端复用）
// 合并改造：保留骨架的确定性 step 结构与调优物理参数；灌入 SkyBlast v2 全部玩法系统：
//   环形地图碰撞 / 7 主武器+8 副武器 / 爆头穿透 / 有限备弹换弹 / 替身人偶回溯 /
//   受重力地雷(直击+瞬发) / 空袭 / 可破坏障碍物 / 占领点 / 弹药经济 / 补给箱 / 迫击炮
// 单位制：秒制（v2 px/frame@60 → px/s：速度×60）。随机量全部走注入的 Rng。
import { applyGravity, jetpack, jump, move, updateJetpackFuel, getPhysicsParams } from './physics.ts'
import { Terrain, OBSTACLE_PRESETS, TILE_SIZE } from '../terrain.ts'
import { Rng } from '../rng.ts'
import { WEAPONS, SECONDARIES, DEFAULT_CONFIG, weaponFalloff } from '../weapons.ts'
import type { GameConfig } from '../weapons.ts'
import { WORLD_W, WORLD_H, SURFACE_Y, wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist, clamp } from '../wrap.ts'
import { defaultWorldInput } from '../types.ts'
import type { WorldInput, WorldEvent, PlayerState, Projectile, Grenade, Landmine, Airstrike, Obstacle, CapturePoint, AmmoPack, SupplyCrate, Mortar, Watchtower, WarpPortal, TeamId } from '../types.ts'
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
  { x: 6800, y: 1020, area: '中央最高浮岛' },
  { x: 4150, y: 3520, area: '西区地下战略掩体' },
  { x: 6600, y: 3500, area: '中央地下核心掩体' },
  { x: 10150, y: 3520, area: '东区地下装甲掩体' },
  { x: 2600, y: 1580, area: '西部高空平台' },
  { x: 10550, y: 1580, area: '东部高空平台' },
]

/** 特殊补给位：只出「替身人偶」（不在常规配装里） */
const DOLL_SUPPLY_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 4820, y: 2100, area: '中西部高空连廊旁' },
  { x: 8560, y: 2760, area: '东区地表特殊补给点' },
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

const WATCHTOWERS: Watchtower[] = [
  { id: 'tower_1', name: '西部高空瞭望塔', x: 2580, y: 1620, operatorId: null },
  { id: 'tower_2', name: '中央北塔瞭望台', x: 5840, y: 1600, operatorId: null },
  { id: 'tower_3', name: '中央南塔瞭望台', x: 7360, y: 1600, operatorId: null },
  { id: 'tower_4', name: '东部高空瞭望塔', x: 10580, y: 1620, operatorId: null },
]

const WARP_PORTALS: WarpPortal[] = [
  { id: 'warp_1', name: 'W1 西翼地表传送门', x: 880, y: 2760, targetId: 'warp_2', color: '#06b6d4' },
  { id: 'warp_2', name: 'W2 中央高空浮岛门', x: 6320, y: 1040, targetId: 'warp_1', color: '#06b6d4' },
  { id: 'warp_3', name: 'W3 西区深层地道门', x: 2980, y: 3680, targetId: 'warp_4', color: '#a855f7' },
  { id: 'warp_4', name: 'W4 东区通信楼顶门', x: 9580, y: 2040, targetId: 'warp_3', color: '#a855f7' },
  { id: 'warp_5', name: 'W5 中央地下掩体门', x: 6880, y: 3500, targetId: 'warp_6', color: '#10b981' },
  { id: 'warp_6', name: 'W6 极东边境高台门', x: 12280, y: 2140, targetId: 'warp_5', color: '#10b981' },
]

/** 死斗模式随机出生候选点（按地表/高空平台/掩体分层，落点再经 ensureFreePosition 校验） */
const RANDOM_SPAWN_CANDIDATES: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = []
  // 地表沿线
  for (let x = 400; x < WORLD_W; x += 620) out.push({ x, y: SURFACE_Y - 60 })
  // 高空平台
  for (const p of [{ x: 2700, y: 1120 }, { x: 3700, y: 1840 }, { x: 5250, y: 2000 }, { x: 5400, y: 940 },
                   { x: 8800, y: 1800 }, { x: 9600, y: 1180 }, { x: 11500, y: 1840 }, { x: 12900, y: 1440 }]) {
    out.push(p)
  }
  // 队伍基地与据点
  for (const sp of SPAWN_POINTS) out.push({ x: sp.x, y: sp.y - 60 })
  for (const cp of ['cp_a', 'cp_b', 'cp_c', 'cp_d', 'cp_e']) {
    const map: Record<string, { x: number; y: number }> = {
      cp_a: { x: 1720, y: 1780 }, cp_b: { x: 4150, y: 3500 }, cp_c: { x: 6600, y: 2740 },
      cp_d: { x: 6600, y: 3480 }, cp_e: { x: 11420, y: 1780 },
    }
    out.push(map[cp])
  }
  return out
})()

export const JUMP_PADS: { x: number; y: number; vx: number; vy: number }[] = [
  // 全部位于可站立地表：远离竖井洞、台地内部与出生点（此前 2 个在竖井里、1 个埋在台地内，且完全没渲染 → "莫名弹起"）
  { x: 1000, y: 2800, vx: 210, vy: -810 },
  { x: 4300, y: 2800, vx: 180, vy: -870 },
  { x: 8450, y: 2800, vx: -180, vy: -870 },
  { x: 13050, y: 2800, vx: -210, vy: -810 },
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
  watchtowers: Watchtower[] = WATCHTOWERS.map(t => ({ ...t }))
  warpPortals: WarpPortal[] = WARP_PORTALS
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
    this.watchtowers = WATCHTOWERS.map(t => ({ ...t, operatorId: null }))
    this.landmines = MINE_PRESETS.map((m, i) => ({
      id: -(i + 1), owner: 0, pos: { x: m.x, y: m.y }, vel: { x: 0, y: 0 },
      armed: true, armTimer: 0, triggered: false, fuse: 0,
      instant: false, directHit: false, preset: true, respawnTimer: 0,
    }))
    this.supplyCrates = [
      ...SUPPLY_SPOTS.map((spot, idx) => {
        const w = WEAPONS[4 + (idx % 3)]
        return {
          id: this.crate++, x: spot.x, y: spot.y, area: spot.area, kind: 'weapon' as const,
          weaponId: w.id, weaponName: w.name, color: w.color, active: true, respawnTimer: 0,
        }
      }),
      ...DOLL_SUPPLY_SPOTS.map((spot) => ({
        id: this.crate++, x: spot.x, y: spot.y, area: spot.area, kind: 'doll' as const,
        weaponId: -1, weaponName: '🎎 替身人偶（特殊补给）', color: '#f472b6', active: true, respawnTimer: 0,
      })),
    ]
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
      reloading: false, reloadTimer: 0, fireCooldown: 0, chargeTimer: 0,
      secondary: 'frag', secondaryCooldown: 0,
      fragCharges: DEFAULT_CONFIG.fragMaxCharges, fragRechargeTimer: 0,
      jetpack: false, fuel: getPhysicsParams().jetpackFuel,
      shieldHp: 0, shieldTimer: 0, watchtowerTimer: 0, mountedTowerId: null, warpCooldown: 0,
      doll: null, dollCharges: 0, respawnTimer: 0,
      kills: 0, deaths: 0,
    }
    this.respawnAt(p, team)
    this.players.push(p)
    return p
  }

  /** 部署/重生入口（供组合根/UI 调用；随机出生或占点出生统一走 respawnAt） */
  deploy(p: PlayerState): void {
    this.respawnAt(p, p.team)
  }

  /** 出生点：按队伍；优先已占领点（占点重生机制） */
  private respawnAt(p: PlayerState, team: TeamId): void {
    let sx: number, sy: number
    if (this.config.randomSpawn) {
      // 死亡竞赛：全图随机安全点出生
      const spot = RANDOM_SPAWN_CANDIDATES[this.rng.int(RANDOM_SPAWN_CANDIDATES.length)]
      sx = spot.x + this.rng.range(-60, 60)
      sy = spot.y
    } else {
      const owned = this.capturePoints.filter(c => c.ownerTeam === team && c.progress >= 100)
      const cp = owned.length > 0 ? owned[this.rng.int(owned.length)] : null
      const base = SPAWN_POINTS.find(s => s.team === team) ?? SPAWN_POINTS[3]
      sx = cp ? cp.x : base.x
      sy = cp ? cp.y - 60 : base.y
    }
    p.pos = { x: wrapX(sx + this.rng.range(-45, 45)), y: sy }
    p.vel = { x: 0, y: 0 }
    p.hp = this.config.maxHp
    p.ammo = WEAPONS.map(w => w.magSize)
    p.reserveAmmo = WEAPONS.map(w => w.maxReserve)
    p.fragCharges = this.config.fragMaxCharges
    p.fragRechargeTimer = 0
    p.fuel = getPhysicsParams().jetpackFuel * (WEAPONS[p.weaponIndex]?.fuelMult ?? 1)
    p.shieldHp = 0
    p.shieldTimer = 0
    p.watchtowerTimer = 0
    p.mountedTowerId = null
    p.warpCooldown = 0
    p.doll = null
    p.dollCharges = 0
    p.reloading = false
    p.fireCooldown = 0
    p.chargeTimer = 0
    p.secondaryCooldown = 0
    p.deployed = true
    p.alive = true
    p.respawnTimer = 0
    // 出生点安全校验：先穿模解算，再兜底安全位置（防出生即卡死）
    this.resolvePenetration(p)
    this.ensureFreePosition(p)
  }

  // ── 主 step ──────────────────────────────────────────────
  step(dt: number, inputs: Map<number, WorldInput>): void {
    this.tick++
    this.events.length = 0

    for (const p of this.players) {
      const w = inputs.get(p.id) ?? defaultWorldInput()
      this.apply(p, w, dt)
      if (p.deployed) this.physics(p, w, dt)
      // 防卡死：躯干嵌进实体累计 12 tick → 推到最近安全位置
      if (p.deployed && p.alive) {
        // 每 tick 穿模解算：任何原因（出生/传送/挤压/帧漏检）嵌进实体都会被最小轴推出
        if (this.bodyOverlapsAt(p.pos.x, p.pos.y)) {
          const fixed = this.resolvePenetration(p)
          if (fixed) { p.vel.x = 0; p.vel.y = 0 }
          const n = (this.stuckTicks.get(p.id) ?? 0) + 1
          this.stuckTicks.set(p.id, n)
          if (n >= 20) {
            this.ensureFreePosition(p)
            this.stuckTicks.set(p.id, 0)
          }
        } else {
          this.stuckTicks.set(p.id, 0)
        }
      }
    }

    this.separatePlayers()

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
        p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (wep.fuelMult ?? 1))
        p.reloading = false
        p.fireCooldown = Math.max(p.fireCooldown, 0.3)
      }
    }

    p.aim = w.aim
    const wepCur = WEAPONS[p.weaponIndex] ?? WEAPONS[0]
    if (p.mountedTowerId) {
      // 瞭望塔上：不可移动（锁定），只能瞄准/射击/互动
      p.vel.x = 0
      p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (wepCur.fuelMult ?? 1))
    } else {
      // 武器差异：重武器移动更慢（无惯性，直接给目标速度）
      p.vel.x = w.move * getPhysicsParams().moveSpeed * (wepCur.moveSpeedMult ?? 1)
    }
    if (w.jump && this.onGround(p)) jump(p.vel)
    const fuelMax = getPhysicsParams().jetpackFuel * (wepCur.fuelMult ?? 1)
    const fuel = Math.min(p.fuel, fuelMax)
    const canJet = !p.mountedTowerId && w.jetpack && fuel > 0
    if (canJet) jetpack(p.vel, dt, wepCur.ascendMult ?? 1)
    p.jetpack = canJet
    p.fuel = updateJetpackFuel(fuel, w.jetpack, !!p.onGround, dt, fuelMax)

    // 冷却推进
    if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt)
    if (p.secondaryCooldown > 0) p.secondaryCooldown = Math.max(0, p.secondaryCooldown - dt)
    // 手雷自然回复：每 fragRechargeSeconds 回复 1 充能
    if (p.fragCharges < this.config.fragMaxCharges) {
      p.fragRechargeTimer += dt
      if (p.fragRechargeTimer >= this.config.fragRechargeSeconds) {
        p.fragRechargeTimer -= this.config.fragRechargeSeconds
        p.fragCharges = Math.min(this.config.fragMaxCharges, p.fragCharges + 1)
      }
    } else p.fragRechargeTimer = 0
    if (p.shieldTimer > 0) {
      p.shieldTimer -= dt
      if (p.shieldTimer <= 0) { p.shieldTimer = 0; p.shieldHp = 0 }
    }
    if (p.watchtowerTimer > 0) p.watchtowerTimer = Math.max(0, p.watchtowerTimer - dt)
    if (p.warpCooldown > 0) p.warpCooldown = Math.max(0, p.warpCooldown - dt)

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

    // 迫击炮操控中：炮管角度跟随准星（限上半圆），修复"不能瞄准"
    const mountedNow = this.mortars.find(m => m.operatorId === p.id)
    if (mountedNow) {
      let a = p.aim
      if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12
      mountedNow.angle = a
    }

    // 交互（E）：瞭望塔 / 迫击炮
    if (w.interact) this.interact(p)

    // 副武器（瞬时意图）
    if (w.secondary) this.useSecondary(p, w.secondary, dt)

    // 开火：激光类持续光束；蓄力武器先蓄力再出膛；其余直接弹丸
    const wepNow = WEAPONS[p.weaponIndex]
    if (wepNow?.beam) {
      if (w.fire) this.updateContinuousBeam(p, wepNow, dt)
      p.chargeTimer = 0
    } else if ((wepNow?.chargeSeconds ?? 0) > 0) {
      // 蓄力：**按下即开始，一旦开始就自动蓄满击发**（单击也能打出子弹，不需一直按住）
      if (w.fire) p.chargeTimer = Math.max(p.chargeTimer, 1e-4)
      if (p.chargeTimer > 0) {
        p.chargeTimer += dt
        if (p.chargeTimer >= (wepNow?.chargeSeconds ?? 0)) {
          this.fire(p)
          p.chargeTimer = 0
        }
      }
    } else if (w.fire) {
      this.fire(p)
    }
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
        isGravityOrb: !!wep.isGravityOrb, bounces: wep.bounces ?? 0, passWalls: !!wep.passWalls, beam: !!wep.beam, rocket: !!wep.rocket,
        dragPerSecond: wep.dragPerSecond ?? 1,
        weaponId: wep.id, curveRate: wep.curveRate ?? 0, weaponLabel: wep.shortName, color: wep.color,
        r: wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2,
        life: wep.lifeSeconds ?? (wep.id === 2 || wep.id === 4 ? 175 : 130) / 60,
      }))
    }
  }

  /** 距离衰减：按「发射者→命中点」最短环形距离计算武器 falloff 倍率 */
  private projectileFalloff(pr: Projectile, hx: number, hy: number): number {
    if (pr.weaponId < 0) return 1
    const wep = WEAPONS[pr.weaponId]
    if (!wep || wep.falloffStart === undefined) return 1
    const owner = this.players.find(x => x.id === pr.owner)
    if (!owner) return 1
    const dist = wrapDist(owner.pos.x, owner.pos.y - 12, hx, hy)
    return weaponFalloff(wep, dist)
  }

  /** 持续光束：按住开火时每 tick 沿准星射线结算（反射 bounces 次），按 DPS 扣血、按 ammoPerSecond 耗弹 */
  private updateContinuousBeam(p: PlayerState, wep: typeof WEAPONS[number], dt: number): void {
    if (p.respawnTimer > 0 || !p.alive) return
    const wi = p.weaponIndex
    if (p.reloading) return
    if (p.ammo[wi] <= 0) {
      this.startReload(p)
      return
    }
    const dps = wep.damagePerSecond ?? wep.damage * 3
    const aps = wep.ammoPerSecond ?? 4
    p.ammo[wi] = Math.max(0, p.ammo[wi] - aps * dt)
    if (p.ammo[wi] <= 0 && (p.reserveAmmo[wi] || 0) > 0) this.startReload(p)

    const segments: { x1: number; y1: number; x2: number; y2: number }[] = []
    const hitPlayer = new Set<number>([p.id])
    const hitObstacle = new Set<string>()
    let x = wrapX(p.pos.x + Math.cos(p.aim) * 24)
    let y = (p.pos.y - 12) + Math.sin(p.aim) * 24
    let dx = Math.cos(p.aim)
    let dy = Math.sin(p.aim)
    const maxSegLen = 1800
    const step = 10
    const bounces = wep.bounces ?? 0

    for (let b = 0; b <= bounces; b++) {
      let travelled = 0
      let hitWall = false
      while (travelled < maxSegLen) {
        const nx = wrapX(x + dx * step)
        const ny = wrapY(y + dy * step)
        for (const t of this.players) {
          if (t.respawnTimer > 0 || !t.deployed || !t.alive || hitPlayer.has(t.id)) continue
          if (t.id !== p.id && t.team === p.team && p.team !== 'ffa') continue
          const hx = wrapDeltaX(t.pos.x, nx)
          const hy = wrapDeltaY(t.pos.y - 24, ny)
          const isHead = Math.hypot(hx, hy) <= this.config.headRadius + 3
          const bx = Math.abs(wrapDeltaX(t.pos.x, nx))
          const by = wrapDeltaY(t.pos.y, ny)
          if (isHead || (bx <= 14 && by >= -12 && by <= 18)) {
            hitPlayer.add(t.id)
            const mult = isHead ? wep.headshotMult : 1
            this.damage(t, dps * mult * dt, undefined, isHead, false, p.id, p.team, wep.shortName)
          }
        }
        const ob = this.obstacleAt(nx, ny)
        if (ob && !hitObstacle.has(ob.id)) {
          hitObstacle.add(ob.id)
          this.damageObstacle(ob, dps * dt, undefined)
        }
        if (this.terrain.isSolidAt(nx, ny)) {
          hitWall = true
          const hitX = this.terrain.isSolidAt(nx, y)
          const hitY = this.terrain.isSolidAt(x, ny)
          if (hitX) dx = -dx
          if (hitY) dy = -dy
          if (!hitX && !hitY) { dx = -dx; dy = -dy }
          break
        }
        x = nx
        y = ny
        travelled += step
      }
      const seg = { x1: 0, y1: 0, x2: x, y2: y }
      if (segments.length > 0) {
        const prev = segments[segments.length - 1]
        seg.x1 = prev.x2; seg.y1 = prev.y2
      } else {
        seg.x1 = wrapX(p.pos.x + Math.cos(p.aim) * 24)
        seg.y1 = (p.pos.y - 12) + Math.sin(p.aim) * 24
      }
      segments.push(seg)
      if (!hitWall) break
    }

    this.events.push({
      kind: 'laser',
      x: p.pos.x, y: p.pos.y,
      segments,
      duration: 0.06,      // 每 tick 刷新一次 → 视觉上是连续光束
      color: wep.color,
      playerId: p.id,
      weaponLabel: wep.shortName,
    } as WorldEvent)
  }

  private makeProjectile(p: PlayerState, x: number, y: number, vx: number, vy: number, o: {
    damage: number; headshotMult: number; terrainRadius: number; explosive: boolean; gravityScale?: number;
    pierceOnHeadshot?: boolean; pierceAll?: boolean; isGravityOrb?: boolean; bounces?: number
    passWalls?: boolean; beam?: boolean; rocket?: boolean; dragPerSecond?: number; weaponId?: number; curveRate?: number
    weaponLabel: string; color: string; r: number; life: number
  }): Projectile {
    return {
      id: this.prj++, owner: p.id, pos: { x: wrapX(x), y: wrapY(y) }, vel: { x: vx, y: vy },
      life: o.life, r: o.r, damage: o.damage, headshotMult: o.headshotMult,
      explosive: o.explosive, terrainRadius: o.terrainRadius, gravityScale: o.gravityScale ?? 0.04,
      pierceOnHeadshot: !!o.pierceOnHeadshot, pierceAll: !!o.pierceAll,
      isGravityOrb: !!o.isGravityOrb, bounces: o.bounces ?? 0, passWalls: !!o.passWalls, beam: !!o.beam, rocket: !!o.rocket,
      dragPerSecond: o.dragPerSecond ?? 1, weaponId: o.weaponId ?? -1, curveRate: o.curveRate ?? 0,
      weaponLabel: o.weaponLabel, color: o.color,
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

    // 手榴弹：消耗 1 充能（上限 fragMaxCharges，自然回复）
    if (s.type === 'frag') {
      if (p.fragCharges <= 0) return
      p.fragCharges--
      p.secondaryCooldown = Math.max(p.secondaryCooldown, 0.8)
      const throwSpeed = 760
      this.grenades.push({
        id: this.gren++,
        owner: p.id,
        pos: { x: wrapX(p.pos.x + Math.cos(p.aim) * 20), y: p.pos.y - 16 + Math.sin(p.aim) * 20 },
        vel: { x: Math.cos(p.aim) * throwSpeed + p.vel.x * 0.25, y: Math.sin(p.aim) * throwSpeed - 96 + p.vel.y * 0.2 },
        fuse: this.config.grenadeFuse, bounces: 0,
      })
      return
    }

    // 替身人偶：只从特殊补给获得（消耗充能）
    if (s.type === 'doll') {
      if (p.dollCharges <= 0) return
      p.dollCharges--
      p.secondaryCooldown = def.cd
      p.doll = {
        pos: { x: p.pos.x, y: p.pos.y }, hp: p.hp, shieldHp: p.shieldHp, fuel: p.fuel,
        weaponIndex: p.weaponIndex, ammo: [...p.ammo], reserveAmmo: [...p.reserveAmmo],
        timer: this.config.dollDuration,
      }
      this.events.push({ kind: 'doll_recall', x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: 'anchor' })
      return
    }
  }

  // ── 交互（E 键） ──────────────────────────────────────────
  /** 替身人偶回溯（死亡触发 或 10s 到期触发） */
  private recallDoll(p: PlayerState, _ev: 'doll_recall'): void {
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
    // 已在塔上 → 下塔（视野加成立即消失）
    if (p.mountedTowerId) {
      const tw = this.watchtowers.find(t => t.id === p.mountedTowerId)
      if (tw) tw.operatorId = null
      p.mountedTowerId = null
      p.watchtowerTimer = 0
      p.vel = { x: 0, y: -160 }   // 下塔后自然下落
      this.events.push({ kind: 'warp', x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: '离开瞭望塔' })
      return
    }
    // 上塔：锁定在塔顶、不能移动、视野 200%
    for (const tw of this.watchtowers) {
      if (tw.operatorId === null && wrapDist(p.pos.x, p.pos.y, tw.x, tw.y) < 130) {
        tw.operatorId = p.id
        p.mountedTowerId = tw.id
        p.pos = { x: tw.x, y: tw.y - 150 + 12 }   // 塔顶平台
        p.vel = { x: 0, y: 0 }
        p.onGround = false
        this.events.push({ kind: 'warp', x: tw.x, y: tw.y, playerId: p.id, weaponName: `登上${tw.name}（视野 200%）` })
        return
      }
    }
    // 量子传送门：配对跃迁 + 2.5s 冷却
    for (const wp of this.warpPortals) {
      if (wrapDist(p.pos.x, p.pos.y, wp.x, wp.y) < 90 && p.warpCooldown <= 0) {
        const dest = this.warpPortals.find(w => w.id === wp.targetId)
        if (!dest) continue
        p.pos = { x: dest.x, y: dest.y - 60 }
        p.vel = { x: 0, y: 0 }
        p.warpCooldown = 2.5
        this.events.push({ kind: 'warp', x: dest.x, y: dest.y, playerId: p.id, weaponName: wp.name })
        return
      }
    }
  }

  // ── 物理 ──────────────────────────────────────────────
  private physics(p: PlayerState, w: WorldInput, dt: number): void {
    if (!p.alive || p.respawnTimer > 0) return
    // 迫击炮操控中：吸附在炮位
    const m = this.mortars.find(mm => mm.operatorId === p.id)
    if (m) {
      p.pos = { x: m.x, y: m.y - 16 }
      p.vel = { x: 0, y: 0 }
      return
    }
    // 瞭望塔上：锁定在塔顶平台
    if (p.mountedTowerId) {
      const tw = this.watchtowers.find(t => t.id === p.mountedTowerId)
      if (tw) {
        p.pos = { x: tw.x, y: tw.y - 150 + 12 }
        p.vel = { x: 0, y: 0 }
        p.onGround = false
        return
      }
    }
    // 与原来一致：上升加速由喷气推力渐变实现；下降加速按住下键 → 重力×1.55（原版数值）
    applyGravity(p.vel, dt, w.dive ? 1.55 : 1)
    // 不用 integrate()：移动由下面的试探-回退碰撞统一控制（v2 模式），避免双重积分

    // 弹射跳台：仅「站在地面」时触发（半径 34），空中经过或坠落竖井不再误触
    for (const pad of JUMP_PADS) {
      const d = wrapDist(p.pos.x, p.pos.y, pad.x, pad.y)
      if (d < 34 && p.onGround && p.vel.y >= -20) {
        p.vel.x += pad.vx
        p.vel.y = pad.vy
        p.onGround = false
      }
    }

    // 身体碰撞（6 采样点，v2 checkBodyCollision）
    const hitBody = (x: number, y: number): boolean => {
      const wx = wrapX(x)
      if (this.terrain.isSolidAt(wx, y)) return true
      if (this.obstacleAt(wx, y) !== null) return true
      return this.playerHitsPoint(wx, y, p.id)
    }
    const pts = (cx: number, cy: number): boolean =>
      hitBody(cx - BODY_HALF_W, cy + BODY_BOTTOM) || hitBody(cx + BODY_HALF_W, cy + BODY_BOTTOM) ||
      hitBody(cx, cy + BODY_BOTTOM) || hitBody(cx - BODY_HALF_W, cy) ||
      hitBody(cx + BODY_HALF_W, cy) || hitBody(cx, cy - BODY_TOP)

    const nx = wrapX(p.pos.x + p.vel.x * dt)
    if (!pts(nx, p.pos.y)) p.pos.x = nx
    else if (!pts(nx, p.pos.y - 10)) { p.pos.x = nx; p.pos.y -= 10 }   // 自动上台阶
    else {
      // 被其他玩家挡住：轻推对方（"顶着人"），否则直接停住（不滑）
      const blocker = this.playerBlockingAt(nx, p.pos.y, p.id)
      if (blocker) this.tryNudge(blocker, Math.sign(nx - p.pos.x), 1.4)
      p.vel.x = 0
    }

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

    // 引力弹：位移式牵引（物理移动之后施加，碰撞安全；可被玩家反向移动抵消）
    this.applyGravityOrbPull(p, dt)
  }

  private onGround(p: PlayerState): boolean {
    return !!p.onGround
  }

  /** 躯干/头是否嵌在实体里（站立在地面上不算——只查躯干以上） */
  private torsoBlockedAt(x: number, y: number): boolean {
    const wx = wrapX(x)
    const pts: [number, number][] = [
      [wx - 10, y - 4], [wx + 10, y - 4], [wx, y - 6],
      [wx - 10, y - 26], [wx + 10, y - 26], [wx, y - 30],
    ]
    for (const [px, py] of pts) {
      if (this.terrain.isSolidAt(px, py)) return true
      if (this.obstacleAt(px, py)) return true
    }
    return false
  }

  /** 把玩家挪到最近的安全位置（出生/被结构挤压/死角兜底） */
  private ensureFreePosition(p: PlayerState): boolean {
    if (!this.torsoBlockedAt(p.pos.x, p.pos.y)) return false
    for (let r = 24; r <= 320; r += 24) {
      for (let a = 0; a < 16; a++) {
        const ang = (a * Math.PI) / 8
        const x = wrapX(p.pos.x + Math.cos(ang) * r)
        const y = wrapY(p.pos.y + Math.sin(ang) * r)
        if (!this.torsoBlockedAt(x, y)) {
          p.pos = { x, y }
          p.vel = { x: 0, y: 0 }
          return true
        }
      }
    }
    // 兜底：队伍主基地
    const base = SPAWN_POINTS.find(s => s.team === p.team) ?? SPAWN_POINTS[3]
    p.pos = { x: wrapX(base.x), y: base.y }
    p.vel = { x: 0, y: 0 }
    return true
  }

  // 卡死计数器：身体嵌实体超时自动推出（防窄缝/结构挤压永久卡住）
  private stuckTicks = new Map<number, number>()

  /** 身体 AABB（脚底锚点）：宽±10，高 -30..+16 */
  /** 两个玩家身体 AABB 是否相交（宽 20，高 -30..+16，脚底锚点） */
  private bodiesOverlap(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = Math.abs(wrapDeltaX(ax, bx))
    if (dx >= 20) return false
    return (ay + 16) > (by - 30) && (ay - 30) < (by + 16)
  }

  /** 单个点是否落在其他玩家身体 AABB 内（用于 6 采样点碰撞；不能把采样点当整具身体） */
  private playerHitsPoint(x: number, y: number, selfId: number): boolean {
    for (const other of this.players) {
      if (other.id === selfId) continue
      if (!other.deployed || !other.alive || other.respawnTimer > 0) continue
      if (Math.abs(wrapDeltaX(x, other.pos.x)) > 10) continue
      if (y > other.pos.y - 30 && y < other.pos.y + 16) return true
    }
    return false
  }

  /** 找指定位置与玩家 selfId 身体相交的其他玩家（用于玩家间碰撞） */
  private playerBlockingAt(x: number, y: number, selfId: number): PlayerState | null {
    for (const other of this.players) {
      if (other.id === selfId) continue
      if (!other.deployed || !other.alive || other.respawnTimer > 0) continue
      if (this.bodiesOverlap(x, y, other.pos.x, other.pos.y)) return other
    }
    return null
  }

  /** 轻推另一个玩家（"顶着人"：被挡住时把对方朝同方向推一点，仍需避让地形/障碍/其他人） */
  private tryNudge(other: PlayerState, dir: number, amount: number): void {
    if (dir === 0) return
    const nx = wrapX(other.pos.x + dir * amount)
    if (this.terrain.isSolidAt(nx, other.pos.y - 6)) return
    if (this.terrain.isSolidAt(nx, other.pos.y + 15)) return   // y+16 是脚底贴地采样，别把地面当墙
    if (this.obstacleAt(nx, other.pos.y)) return
    for (const t of this.players) {
      if (t.id === other.id) continue
      if (!t.deployed || !t.alive || t.respawnTimer > 0) continue
      if (this.bodiesOverlap(nx, other.pos.y, t.pos.x, t.pos.y)) return
    }
    other.pos.x = nx
  }

  bodyOverlapsAt(x: number, y: number): boolean {
    const wx = wrapX(x)
    const halfW = 10
    // 扫描覆盖身体 AABB 的地形格
    const gx0 = Math.floor((wx - halfW) / TILE_SIZE)
    const gx1 = Math.floor((wx + halfW) / TILE_SIZE)
    const gy0 = Math.floor(wrapY(y - 30) / TILE_SIZE)
    const gy1 = Math.floor(wrapY(y + 16) / TILE_SIZE)
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        // 格子中心 → 玩家局部坐标（跨缝走最短）
        const cellX = wrapX(gx * TILE_SIZE) + TILE_SIZE / 2
        const cellY = wrapY(gy * TILE_SIZE) + TILE_SIZE / 2
        const lx = wrapDeltaX(wx, cellX)
        const ly = wrapDeltaY(y, cellY)
        if (Math.abs(lx) <= halfW + TILE_SIZE / 2 && ly <= 16 + TILE_SIZE / 2 && ly >= -30 - TILE_SIZE / 2) {
          // 该格与身体 AABB 是否真实相交
          const cell = this.terrain.isSolidAt(cellX, cellY)
          if (cell) {
            const tileL = lx - TILE_SIZE / 2
            const tileR = lx + TILE_SIZE / 2
            const tileT = ly - TILE_SIZE / 2
            const tileB = ly + TILE_SIZE / 2
            if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true
          }
        }
      }
    }
    // 障碍物 AABB
    for (const ob of this.obstacles) {
      if (ob.hp <= 0) continue
      const dx = wrapDeltaX(wx, ob.x + ob.w / 2)
      const dy = wrapDeltaY(y, ob.y + ob.h / 2)
      const tileL = dx - ob.w / 2
      const tileR = dx + ob.w / 2
      const tileT = dy - ob.h / 2
      const tileB = dy + ob.h / 2
      if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true
    }
    return false
  }

  /** 最小轴推出（穿模解算）：把玩家从任何嵌入的实体里沿最小穿透方向推出；返回是否推过 */
  private resolvePenetration(p: PlayerState): boolean {
    const halfW = 10
    let moved = false
    for (let iter = 0; iter < 6; iter++) {
      if (!this.bodyOverlapsAt(p.pos.x, p.pos.y)) break
      const wx = wrapX(p.pos.x)
      // 收集所有相交实体（地形格 + 障碍物），取最小推出量
      const pick: { v: { dx: number; dy: number } | null } = { v: null }
      let bestLen = Infinity
      const consider = (tileL: number, tileR: number, tileT: number, tileB: number): void => {
        if (!(tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16)) return
        const cand = [
          { dx: tileL - halfW, dy: 0 },   // 向左
          { dx: tileR + halfW, dy: 0 },   // 向右
          { dx: 0, dy: tileB + 30 },      // 向下（放到 tile 底部之下）
          { dx: 0, dy: tileT - 16 },      // 向上（放到 tile 顶部之上）
        ]
        for (const c of cand) {
          const len = Math.abs(c.dx) + Math.abs(c.dy)
          if (len < bestLen) { bestLen = len; pick.v = c }
        }
      }
      // 地形格
      const gx0 = Math.floor((wx - halfW) / TILE_SIZE)
      const gx1 = Math.floor((wx + halfW) / TILE_SIZE)
      const gy0 = Math.floor(wrapY(p.pos.y - 30) / TILE_SIZE)
      const gy1 = Math.floor(wrapY(p.pos.y + 16) / TILE_SIZE)
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const cellX = wrapX(gx * TILE_SIZE) + TILE_SIZE / 2
          const cellY = wrapY(gy * TILE_SIZE) + TILE_SIZE / 2
          if (!this.terrain.isSolidAt(cellX, cellY)) continue
          const lx = wrapDeltaX(wx, cellX)
          const ly = wrapDeltaY(p.pos.y, cellY)
          consider(lx - TILE_SIZE / 2, lx + TILE_SIZE / 2, ly - TILE_SIZE / 2, ly + TILE_SIZE / 2)
        }
      }
      // 障碍物
      for (const ob of this.obstacles) {
        if (ob.hp <= 0) continue
        const lx = wrapDeltaX(wx, ob.x + ob.w / 2)
        const ly = wrapDeltaY(p.pos.y, ob.y + ob.h / 2)
        consider(lx - ob.w / 2, lx + ob.w / 2, ly - ob.h / 2, ly + ob.h / 2)
      }
      if (pick.v) {
        p.pos.x = wrapX(p.pos.x + pick.v.dx)
        p.pos.y = wrapY(p.pos.y + pick.v.dy)
        moved = true
      } else {
        // 理论不会发生：兜底用安全位置搜索
        this.ensureFreePosition(p)
        moved = true
        break
      }
    }
    return moved
  }

  // ── 弹道 ──────────────────────────────────────────────
  // 子步进（≤8px/步）：高速弹（激光 3000px/s=50px/帧）不会穿过 20px 墙砖；
  // 引力弹 passWalls=true 忽略原始地形；激光撞墙反弹（bounces 次，每次反弹重置命中列表）。
  private stepProjectiles(dt: number): void {
    // 伤害为 0 的弹丸没有任何战斗作用 → 直接删除（不推进、不参与碰撞/牵引/渲染）
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].damage <= 0) this.projectiles.splice(i, 1)
    }
    const g = getPhysicsParams().gravity
    const SUBSTEP_PX = 8

    for (const pr of this.projectiles) {
      if (pr.life <= 0) continue

      if (pr.dragPerSecond < 1) {
        const k = Math.pow(pr.dragPerSecond, dt)   // 每秒保留比例 → 平滑减速
        pr.vel.x *= k
        pr.vel.y *= k
      }
      // 引力场：引力弹会弯曲**其他枪射出的子弹**——把弹道方向朝引力弹方向旋转（真正“弯”而非轻微加速）
      if (!pr.isGravityOrb && !pr.beam) {
        for (const orb of this.projectiles) {
          if (!orb.isGravityOrb || orb.life <= 0) continue
          const dx = wrapDeltaX(pr.pos.x, orb.pos.x)
          const dy = wrapDeltaY(pr.pos.y, orb.pos.y)
          const d = Math.hypot(dx, dy)
          if (d <= 8 || d > 320) continue
          const falloff = 1 - d / 320
          // 期望方向 = 朝引力弹；速度方向绕该方向旋转
          const cur = Math.atan2(pr.vel.y, pr.vel.x)
          const want = Math.atan2(dy, dx)
          let delta = want - cur
          while (delta > Math.PI) delta -= Math.PI * 2
          while (delta < -Math.PI) delta += Math.PI * 2
          const bend = Math.sign(delta) * Math.min(Math.abs(delta), 4.0 * falloff * dt)  // 最大 4 rad/s
          const cosB = Math.cos(bend)
          const sinB = Math.sin(bend)
          const vx = pr.vel.x
          pr.vel.x = vx * cosB - pr.vel.y * sinB
          pr.vel.y = vx * sinB + pr.vel.y * cosB
        }
      }
      pr.vel.y += g * pr.gravityScale * dt
      pr.life -= dt
      if (pr.life <= 0) continue

      const dx = pr.vel.x * dt
      const dy = pr.vel.y * dt
      const dist = Math.hypot(dx, dy)
      const steps = Math.max(1, Math.ceil(dist / SUBSTEP_PX))
      const sx = dx / steps
      const sy = dy / steps
      let dead = false

      for (let step = 0; step < steps; step++) {
        const prevX = pr.pos.x
        const prevY = pr.pos.y
        pr.pos.x = wrapX(pr.pos.x + sx)
        pr.pos.y = wrapY(pr.pos.y + sy)

        // A. 玩家（头/躯干，爆头穿透）
        let hit = false
        for (const t of this.players) {
          if (t.respawnTimer > 0 || !t.deployed || !t.alive || pr.hitTargets.includes(t.id)) continue
          if (t.id !== pr.owner && t.team === this.ownerTeamOf(pr.owner) && t.team !== 'ffa') continue
          const dxHead = wrapDeltaX(t.pos.x, pr.pos.x)
          const dyHead = wrapDeltaY(t.pos.y - 24, pr.pos.y)
          if (Math.hypot(dxHead, dyHead) <= this.config.headRadius + pr.r) {
            pr.hitTargets.push(t.id)
            const piercing = pr.pierceOnHeadshot || pr.pierceAll
            if (pr.explosive) {
              this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage * pr.headshotMult * this.projectileFalloff(pr, pr.pos.x, pr.pos.y), 960, pr)
              hit = true
            } else {
              this.damage(t, Math.round(pr.damage * pr.headshotMult * this.projectileFalloff(pr, t.pos.x, t.pos.y - 24)), pr, true, piercing)
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
              this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage * this.projectileFalloff(pr, pr.pos.x, pr.pos.y), 900, pr)
              hit = true
            } else {
              // 狙击远距规则：超过视距(farRange)的非爆头命中只造成 farDamage（99 → 留 1 血）
              let dmg = Math.round(pr.damage)
              const wep = pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : undefined
              if (wep?.farRange && pr.weaponId === 2) {
                const owner = this.players.find(x => x.id === pr.owner)
                if (owner) {
                  const dist = wrapDist(owner.pos.x, owner.pos.y - 12, t.pos.x, t.pos.y - 12)
                  if (dist > wep.farRange) dmg = Math.min(dmg, wep.farDamage ?? dmg)
                }
              }
              dmg = Math.round(dmg * this.projectileFalloff(pr, t.pos.x, t.pos.y - 12))
              this.damage(t, dmg, pr, false, false)
              t.vel.x += pr.vel.x * 0.09
              t.vel.y += pr.vel.y * 0.09
              if (!pr.pierceAll) hit = true
            }
            if (hit) break
          }
        }
        if (hit) { dead = true; break }

        // B. 可破坏障碍物
        const ob = this.obstacleAt(pr.pos.x, pr.pos.y, pr.r)
        if (ob) {
          if (pr.explosive) {
            this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr)
            dead = true
          } else {
            this.damageObstacle(ob, pr.damage, pr)
            if (!pr.pierceAll) dead = true
          }
          if (dead) break
        }

        // C. 原始地形：引力弹穿墙；激光反弹；其余湮灭
        if (this.terrain.isSolidAt(pr.pos.x, pr.pos.y)) {
          if (pr.passWalls) continue
          if (pr.explosive) {
            this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr)
            dead = true
            break
          }
          if (pr.bounces > 0) {
            const hitX = this.terrain.isSolidAt(pr.pos.x, prevY)
            const hitY = this.terrain.isSolidAt(prevX, pr.pos.y)
            pr.pos = { x: prevX, y: prevY }
            if (hitX) pr.vel.x = -pr.vel.x
            if (hitY) pr.vel.y = -pr.vel.y
            if (!hitX && !hitY) { pr.vel.x = -pr.vel.x; pr.vel.y = -pr.vel.y }
            pr.bounces--
            pr.hitTargets = [pr.owner]
            break   // 本 tick 剩余子步作废，下 tick 继续反射后的方向
          }
          dead = true
          break
        }
      }

      if (dead) pr.life = 0
    }
  }

  /** 引力弹持续牵引（位移式）：把附近玩家朝弹体位置拉，碰撞安全；最大 240px/s < 常规移动 300 → 可抵抗 */
  private applyGravityOrbPull(p: PlayerState, dt: number): void {
    const RANGE = 260
    const MAX_PULL = 240
    const MIN_RATIO = 0.35
    let vx = 0
    let vy = 0
    for (const pr of this.projectiles) {
      if (!pr.isGravityOrb || pr.life <= 0) continue
      const dx = wrapDeltaX(p.pos.x, pr.pos.x)
      const dy = wrapDeltaY(p.pos.y - 12, pr.pos.y)
      const d = Math.hypot(dx, dy)
      if (d > RANGE || d < 8) continue
      const strength = MAX_PULL * (MIN_RATIO + (1 - MIN_RATIO) * (1 - d / RANGE))
      vx += (dx / d) * strength
      vy += (dy / d) * strength
    }
    if (vx === 0 && vy === 0) return
    // 位移式牵引：逐轴试探，不穿墙；玩家反向移动（300px/s）可抵消 ≤240px/s 的牵引
    const tryX = wrapX(p.pos.x + vx * dt)
    if (!this.bodyOverlapsAt(tryX, p.pos.y)) p.pos.x = tryX
    const tryY = wrapY(p.pos.y + vy * dt)
    if (!this.bodyOverlapsAt(p.pos.x, tryY)) p.pos.y = tryY
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
        if (wrapDist(p.pos.x, p.pos.y, crate.x, crate.y) < 56) {
          crate.active = false
          crate.respawnTimer = this.config.supplyRespawnTime
          if (crate.kind === 'doll') {
            p.dollCharges = Math.min(this.config.dollMaxCharges, p.dollCharges + 1)
          } else {
            p.weaponIndex = crate.weaponId
            p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (WEAPONS[crate.weaponId].fuelMult ?? 1))
            p.ammo[crate.weaponId] = WEAPONS[crate.weaponId].magSize
            p.reserveAmmo[crate.weaponId] = WEAPONS[crate.weaponId].maxReserve
          }
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
        if (wrapDist(p.pos.x, p.pos.y, pack.x, pack.y) < 52) {
          const wep = WEAPONS[p.weaponIndex]
          p.reserveAmmo[p.weaponIndex] = Math.min(wep.maxReserve * 2, (p.reserveAmmo[p.weaponIndex] || 0) + wep.maxReserve)
          this.ammoPacks.splice(i, 1)
          this.events.push({ kind: 'ammo_pickup', playerId: p.id, x: pack.x, y: pack.y })
          break
        }
      }
    }
  }

  /** 玩家重叠分离：两两检查，沿 x 各推 0.5px（受地形/障碍/其他人限制），避免叠人卡死 */
  private separatePlayers(): void {
    const list = this.players.filter(p => p.deployed && p.alive && p.respawnTimer <= 0)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (!this.bodiesOverlap(a.pos.x, a.pos.y, b.pos.x, b.pos.y)) continue
        const dir = Math.sign(wrapDeltaX(a.pos.x, b.pos.x)) || 1
        this.tryNudge(b, dir, 0.6)
        this.tryNudge(a, -dir, 0.6)
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
