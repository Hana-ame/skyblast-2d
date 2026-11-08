// core/sim/world.ts —— 服务器权威世界容器与子系统编排器（确定性，零 IO，可在服务端复用）
// 架构重构：消除 1600 行 God Class，将物理与玩法拆分为 6 个独立纯函数子系统模块：
//   - landmarks.ts       静态地标、出生点与跳台预设
//   - spatial.ts         一维环形空间哈希桶与几何查询
//   - playerPhysics.ts   玩家运动学、采样碰撞、穿模解算、重叠分离与客户端预测纯函数
//   - projectiles.ts     弹丸子步进、高斯枪 2 次反射光线追踪、引力场弯折与牵引
//   - throwables.ts      副武器、手雷、地雷、空袭与爆炸伤害结算 (stepExplosionsAndThrowables)
//   - interactables.ts   占领点、迫击炮、瞭望塔、传送门、补给箱与弹药经济 (stepMapInteractables)
import { jetpack, jump, updateJetpackFuel, getPhysicsParams, recoilDelta } from './physics.ts'
import { Terrain, OBSTACLE_PRESETS } from '../terrain.ts'
import type { MapData } from '../map.ts'
import { Rng } from '../rng.ts'
import { WEAPONS, SECONDARIES, DEFAULT_CONFIG, isSecondaryUnlocked, getHighestUnlockedSecondary } from '../weapons.ts'
import type { GameConfig } from '../weapons.ts'
import { wrapX } from '../wrap.ts'
import { defaultWorldInput } from '../types.ts'
import type {
  WorldInput, WorldEvent, PlayerState, Projectile, Grenade, Landmine,
  Airstrike, Obstacle, CapturePoint, AmmoPack, SupplyCrate, Mortar, Watchtower, WarpPortal, TeamId,
} from '../types.ts'
import type { WorldSnapshot } from '../snap.ts'

import {
  SPAWN_POINTS, AMMO_SPOTS, SUPPLY_SPOTS, DOLL_SUPPLY_SPOTS,
  MORTARS_INIT, MINE_PRESETS, WATCHTOWERS, WARP_PORTALS,
  RANDOM_SPAWN_CANDIDATES, JUMP_PADS, CP_INITS,
} from './landmarks.ts'
import {
  BUCKET_SIZE, INV_BUCKET_SIZE, NUM_BUCKETS, PLAYER_BROAD_PAD, OBSTACLE_BROAD_PAD,
  bucketIdx, checkBodyOverlapsAt,
} from './spatial.ts'
import {
  ensureFreePosition, resolvePenetration, stepPlayerKinematic, separateOverlappingPlayers,
} from './playerPhysics.ts'
import {
  createProjectile, updateContinuousBeam, applyGravityOrbPull, stepProjectilesSubsystem,
} from './projectiles.ts'
import type { ProjectileContext } from './projectiles.ts'
import {
  stepPlayerTeleport, useSecondaryInWorld, damageObstacleInWorld, damagePlayerInWorld, explodeInWorld, stepExplosionsAndThrowables,
} from './throwables.ts'
import type { ThrowablesContext } from './throwables.ts'
import {
  recallDollState, handlePlayerInteract, spawnSingleAmmoPack, stepMapInteractables,
} from './interactables.ts'
import type { InteractablesContext } from './interactables.ts'

export { SPAWN_POINTS, AMMO_SPOTS, JUMP_PADS }

export class World implements ProjectileContext, ThrowablesContext, InteractablesContext {
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
  events: WorldEvent[] = []
  config: GameConfig = { ...DEFAULT_CONFIG }
  rng: Rng
  seed: number
  tick = 0
  hits = 0

  private pid = 1
  private prj = 1
  private gren = 1
  private obsSeq = 1
  private mineSeq = 1
  private ammo = 1
  private crate = 1
  private ammoSpawnTimer = 0
  private stuckTicks = new Map<number, number>()

  playerBroadBuckets: PlayerState[][] = Array.from({ length: NUM_BUCKETS }, () => [])
  obstacleBroadBuckets: Obstacle[][] = Array.from({ length: NUM_BUCKETS }, () => [])
  playerById = new Map<number, PlayerState>()
  activeGravityOrbs: Projectile[] = []

  constructor(seed = 12345, map?: MapData) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.terrain.build(map?.solids)
    this.resetMatch()
  }

  // ── 子系统接口方法 ──
  nextProjId(): number { return this.prj++ }
  nextGrenadeId(): number { return this.gren++ }
  nextObstacleSeq(): number { return this.obsSeq++ }
  nextMineId(): number { return this.mineSeq++ }
  nextAmmoId(): number { return this.ammo++ }
  getAmmoTimer(): number { return this.ammoSpawnTimer }
  setAmmoTimer(t: number): void { this.ammoSpawnTimer = t }
  rebuildSpatial(): void { this.rebuildSpatialBuckets() }
  onHitCount(): void { this.hits++ }
  ownerTeamOf(id: number): TeamId {
    return (this.playerById.get(id) ?? this.players.find(p => p.id === id))?.team ?? 'ffa'
  }
  recallDoll(p: PlayerState): void {
    recallDollState(this.events, p)
  }
  damagePlayer(
    t: PlayerState,
    amount: number,
    pr: Projectile | undefined,
    isHead: boolean,
    isPierced: boolean,
    attackerId?: number,
    attackerTeam?: TeamId,
    weaponLabel?: string,
  ): void {
    damagePlayerInWorld(this, t, amount, pr, isHead, isPierced, attackerId, attackerTeam, weaponLabel)
  }
  damageObstacle(ob: Obstacle, dmg: number): void {
    damageObstacleInWorld(this, ob, dmg)
  }
  explode(
    cx: number,
    cy: number,
    radius: number,
    maxDamage: number,
    knockback: number,
    pr?: Projectile,
    ownerId?: number,
    ownerTeam?: TeamId,
    weaponLabel?: string,
    implosion = false,
  ): void {
    explodeInWorld(this, cx, cy, radius, maxDamage, knockback, pr, ownerId, ownerTeam, weaponLabel, implosion)
  }
  startReload(p: PlayerState): void {
    const wep = WEAPONS[p.weaponIndex]
    if (!wep || p.reloading || p.ammo[p.weaponIndex] >= wep.magSize) return
    if ((p.reserveAmmo[p.weaponIndex] || 0) <= 0) return
    p.reloading = true
    // 逐发装填（霰弹）：整匣时间平摊到每发；装满一发的耗时 = reloadTime / magSize
    p.reloadTimer = wep.shellReload ? wep.reloadTime / Math.max(1, wep.magSize) : wep.reloadTime
  }

  private rebuildSpatialBuckets(): void {
    for (let i = 0; i < NUM_BUCKETS; i++) {
      this.playerBroadBuckets[i].length = 0
      this.obstacleBroadBuckets[i].length = 0
    }
    this.playerById.clear()
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]
      this.playerById.set(p.id, p)
      if (!p.deployed || !p.alive || p.respawnTimer > 0) continue
      const wx = wrapX(p.pos.x)
      const b0 = bucketIdx(wrapX(wx - PLAYER_BROAD_PAD))
      const b1 = bucketIdx(wrapX(wx + PLAYER_BROAD_PAD))
      this.playerBroadBuckets[b0].push(p)
      if (b1 !== b0) this.playerBroadBuckets[b1].push(p)
    }
    for (let i = 0; i < this.obstacles.length; i++) {
      const ob = this.obstacles[i]
      if (ob.hp <= 0) continue
      const startX = ob.x - OBSTACLE_BROAD_PAD
      const endX = ob.x + ob.w + OBSTACLE_BROAD_PAD
      const steps = Math.ceil((endX - startX) * INV_BUCKET_SIZE) + 1
      let prevB = -1
      for (let s = 0; s <= steps; s++) {
        const px = Math.min(endX, startX + s * BUCKET_SIZE)
        const b = bucketIdx(wrapX(px))
        if (b !== prevB) {
          if (!this.obstacleBroadBuckets[b].includes(ob)) this.obstacleBroadBuckets[b].push(ob)
          prevB = b
        }
      }
    }
  }

  private rebuildPlayerBucketsOnly(): void {
    for (let i = 0; i < NUM_BUCKETS; i++) this.playerBroadBuckets[i].length = 0
    this.playerById.clear()
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]
      this.playerById.set(p.id, p)
      if (!p.deployed || !p.alive || p.respawnTimer > 0) continue
      const wx = wrapX(p.pos.x)
      const b0 = bucketIdx(wrapX(wx - PLAYER_BROAD_PAD))
      const b1 = bucketIdx(wrapX(wx + PLAYER_BROAD_PAD))
      this.playerBroadBuckets[b0].push(p)
      if (b1 !== b0) this.playerBroadBuckets[b1].push(p)
    }
  }

  resetMatch(): void {
    this.obsSeq = 1
    this.mineSeq = 1
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
    for (let i = 0; i < this.config.ammoPackMaxActive; i++) spawnSingleAmmoPack(this)
    this.projectiles = []
    this.grenades = []
    this.airstrikes = []
    this.ammoSpawnTimer = 0
    this.scores = { red: 0, blue: 0, green: 0, ffa: 0 }
    this.rebuildSpatialBuckets()
  }

  addPlayer(name = 'Player', team: TeamId = 'ffa'): PlayerState {
    const p: PlayerState = {
      id: this.pid++,
      pos: { x: 6600, y: 2380 }, vel: { x: 0, y: 0 },
      aim: 0, team, name,
      hp: this.config.maxHp, maxHp: this.config.maxHp,
      alive: true, deployed: true, onGround: true,
      weaponIndex: 1,
      lastPrimaryIndex: 1,
      ammo: WEAPONS.map(w => w.magSize),
      reserveAmmo: WEAPONS.map(w => w.maxReserve),
      reloading: false, reloadTimer: 0, fireCooldown: 0, chargeTimer: 0,
      secondary: 'frag', secondaryCooldown: 0,
      fragCharges: DEFAULT_CONFIG.fragMaxCharges, fragRechargeTimer: 0,
      jetpack: false, fuel: getPhysicsParams().jetpackFuel,
      shieldHp: 0, shieldTimer: 0, watchtowerTimer: 0, mountedTowerId: null, warpCooldown: 0,
      teleportTimer: 0, teleportTarget: null,
      doll: null, dollCharges: 0, respawnTimer: 0,
      kills: 0, deaths: 0, deathStreak: 0,
    }
    this.respawnAt(p, team)
    this.players.push(p)
    this.playerById.set(p.id, p)
    return p
  }

  deploy(p: PlayerState): void {
    this.respawnAt(p, p.team)
  }

  private respawnAt(p: PlayerState, team: TeamId): void {
    const cur = WEAPONS[p.weaponIndex]
    const lastIdx = p.lastPrimaryIndex ?? p.weaponIndex
    if (!cur || cur.isSupplyOnly) {
      const fallback = WEAPONS[lastIdx] && !WEAPONS[lastIdx].isSupplyOnly ? lastIdx : 0
      p.weaponIndex = fallback
      p.lastPrimaryIndex = fallback
    } else {
      p.lastPrimaryIndex = p.weaponIndex
    }
    let sx: number, sy: number
    if (this.config.randomSpawn) {
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
    p.shieldHp = 0; p.shieldTimer = 0; p.watchtowerTimer = 0; p.mountedTowerId = null; p.warpCooldown = 0
    p.teleportTimer = 0; p.teleportTarget = null
    const streak = p.deathStreak ?? 0
    p.doll = null
    p.dollCharges = streak >= SECONDARIES.doll.unlockStreak ? 1 : 0
    if (!SECONDARIES[p.secondary] || !isSecondaryUnlocked(p.secondary, streak, p.dollCharges)) {
      p.secondary = getHighestUnlockedSecondary(streak, p.dollCharges)
    }
    p.reloading = false; p.fireCooldown = 0; p.chargeTimer = 0; p.chargeAim = undefined; p.secondaryCooldown = 0
    p.deployed = true; p.alive = true; p.respawnTimer = 0
    resolvePenetration(this.terrain, this.obstacles, this.obstacleBroadBuckets, p)
    ensureFreePosition(this.terrain, this.obstacles, this.obstacleBroadBuckets, p)
  }

  // ── 主 step：按子系统顺序编排 ──────────────────────────────
  step(dt: number, inputs: Map<number, WorldInput>): void {
    this.tick++
    this.events.length = 0
    this.rebuildSpatialBuckets()

    this.activeGravityOrbs.length = 0
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i]
      if (pr.isGravityOrb && pr.life > 0 && pr.damage > 0) this.activeGravityOrbs.push(pr)
    }

    // 1. 玩家输入与物理子系统
    for (const p of this.players) {
      const w = inputs.get(p.id) ?? defaultWorldInput()
      this.applyPlayerInput(p, w, dt)
      if (p.deployed) {
        stepPlayerKinematic(
          p, w, dt, this.terrain, this.obstacles,
          this.obstacleBroadBuckets, this.playerBroadBuckets,
          this.mortars, this.watchtowers,
        )
        if (p.alive && p.respawnTimer <= 0 && this.activeGravityOrbs.length > 0) {
          applyGravityOrbPull(this.terrain, this.obstacles, this.activeGravityOrbs, p, dt, this.obstacleBroadBuckets)
        }
      }
      if (p.deployed && p.alive) {
        if (this.bodyOverlapsAt(p.pos.x, p.pos.y)) {
          const fixed = resolvePenetration(this.terrain, this.obstacles, this.obstacleBroadBuckets, p)
          if (fixed) { p.vel.x = 0; p.vel.y = 0 }
          const n = (this.stuckTicks.get(p.id) ?? 0) + 1
          this.stuckTicks.set(p.id, n)
          if (n >= 20) {
            ensureFreePosition(this.terrain, this.obstacles, this.obstacleBroadBuckets, p)
            this.stuckTicks.set(p.id, 0)
          }
        } else {
          this.stuckTicks.set(p.id, 0)
        }
      }
    }

    this.rebuildPlayerBucketsOnly()
    separateOverlappingPlayers(this.players, this.playerBroadBuckets, this.terrain, this.obstacles, this.obstacleBroadBuckets)
    this.rebuildPlayerBucketsOnly()

    // 2. 弹道与力场子系统
    stepProjectilesSubsystem(this, dt)

    // 3. 投掷物、地雷、空袭与爆炸子系统
    stepExplosionsAndThrowables(this, dt)

    // 4. 地图互动设施子系统
    stepMapInteractables(this, dt)

    // 5. 原地双指针清理失效实体
    let pw = 0
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i]
      if (pr.life > 0 && pr.damage > 0) {
        this.projectiles[pw++] = pr
      } else if (!this.events.some(e => e.kind === 'projectile_destroy' && e.projectileId === pr.id)) {
        this.events.push({ kind: 'projectile_destroy', projectileId: pr.id })
      }
    }
    this.projectiles.length = pw

    let gw = 0
    for (let i = 0; i < this.grenades.length; i++) {
      if (this.grenades[i].fuse > 0) this.grenades[gw++] = this.grenades[i]
    }
    this.grenades.length = gw
  }

  drainEvents(): WorldEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  bodyOverlapsAt(x: number, y: number): boolean {
    return checkBodyOverlapsAt(this.terrain, this.obstacles, x, y, this.obstacleBroadBuckets)
  }

  private applyPlayerInput(p: PlayerState, w: WorldInput, dt: number): void {
    if (!p.deployed) return
    if (p.respawnTimer > 0) {
      p.respawnTimer -= dt
      if (p.respawnTimer <= 0) this.respawnAt(p, p.team)
      return
    }
    if (!p.alive) return

    if (w.switchWeapon !== null && w.switchWeapon !== p.weaponIndex) {
      const wep = WEAPONS[w.switchWeapon]
      const canSwitch = !this.config.loadoutLock || p.respawnTimer > 0 || !p.deployed
      if (wep && !wep.isSupplyOnly && canSwitch) {
        p.weaponIndex = wep.id
        p.lastPrimaryIndex = wep.id
        p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (wep.fuelMult ?? 1))
        p.reloading = false
        p.fireCooldown = Math.max(p.fireCooldown, 0.3)
      }
    }

    const charging = p.chargeTimer > 0 && p.chargeAim !== undefined
    p.aim = charging ? p.chargeAim! : w.aim
    const wepCur = WEAPONS[p.weaponIndex] ?? WEAPONS[0]
    if (p.mountedTowerId) {
      p.vel.x = 0
      p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (wepCur.fuelMult ?? 1))
    } else {
      p.vel.x = w.move * getPhysicsParams().moveSpeed * (wepCur.moveSpeedMult ?? 1)
    }
    if (w.jump && p.onGround) jump(p.vel)
    const fuelMax = getPhysicsParams().jetpackFuel * (wepCur.fuelMult ?? 1)
    const fuel = Math.min(p.fuel, fuelMax)
    const canJet = !p.mountedTowerId && w.jetpack && fuel > 0
    if (canJet) jetpack(p.vel, dt, wepCur.ascendMult ?? 1)
    p.jetpack = canJet
    p.fuel = updateJetpackFuel(fuel, w.jetpack, !!p.onGround, dt, fuelMax)

    if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt)
    if (p.secondaryCooldown > 0) p.secondaryCooldown = Math.max(0, p.secondaryCooldown - dt)
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
    stepPlayerTeleport(this, p, dt)

    if (p.reloading) {
      p.reloadTimer -= dt
      if (p.reloadTimer <= 0) {
        const wep = WEAPONS[p.weaponIndex]
        const avail = p.reserveAmmo[p.weaponIndex] || 0
        if (wep.shellReload) {
          // 逐发装填：装进 1 发即可击发；若弹匣未满且还有备弹，自动继续装下一发
          if (avail > 0 && p.ammo[p.weaponIndex] < wep.magSize) {
            p.ammo[p.weaponIndex] += 1
            p.reserveAmmo[p.weaponIndex] = avail - 1
          }
          const stillNeeds = p.ammo[p.weaponIndex] < wep.magSize && (p.reserveAmmo[p.weaponIndex] || 0) > 0
          if (stillNeeds) p.reloadTimer = wep.reloadTime / Math.max(1, wep.magSize)
          else p.reloading = false
        } else {
          p.reloading = false
          const needed = wep.magSize - p.ammo[p.weaponIndex]
          const transfer = Math.min(needed, avail)
          p.ammo[p.weaponIndex] += transfer
          p.reserveAmmo[p.weaponIndex] = avail - transfer
        }
      }
    }
    if (w.reload) this.startReload(p)

    if (p.doll) {
      p.doll.timer -= dt
      if (p.doll.timer <= 0) recallDollState(this.events, p)
    }

    const mountedNow = this.mortars.find(m => m.operatorId === p.id)
    if (mountedNow) {
      let a = p.aim
      if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12
      mountedNow.angle = a
    }

    if (w.interact) handlePlayerInteract(this, p)
    if (w.secondary) useSecondaryInWorld(this, p, w.secondary)

    const wepNow = WEAPONS[p.weaponIndex]
    if (wepNow?.beam) {
      if (w.fire) updateContinuousBeam(this, p, wepNow, dt)
      p.chargeTimer = 0
    } else if ((wepNow?.chargeSeconds ?? 0) > 0) {
      // 蓄力武器（狙击）：**按下沿**开始读条，不需要按住；
      // 发射方向锁定为「按下那一刻」的瞄准方向，读条期间不再跟随鼠标。
      const firePressed = w.fire && !p.prevFireHeld
      if (firePressed && p.chargeTimer <= 0 && p.fireCooldown <= 0) {
        if (p.ammo[p.weaponIndex] > 0) {
          p.chargeAim = p.aim          // 锁定按下瞬间的方向
          p.chargeTimer = 1e-4         // 开始读条
        } else if ((p.reserveAmmo[p.weaponIndex] || 0) > 0) {
          this.startReload(p)
        }
      }
      if (p.chargeTimer > 0) {
        p.chargeTimer += dt
        if (p.chargeTimer >= (wepNow?.chargeSeconds ?? 0)) {
          this.fire(p)                 // 读条完成自动发射（方向用锁定的 chargeAim）
          p.chargeTimer = 0
          p.chargeAim = undefined
        }
      }
    } else if (w.fire) {
      this.fire(p)
    }
    // 记录本帧开火键状态，供下一帧做按下沿检测（所有武器共用）
    p.prevFireHeld = w.fire
  }

  private fire(p: PlayerState): void {
    if (p.respawnTimer > 0 || !p.alive) return
    const m = this.mortars.find(mm => mm.operatorId === p.id)
    if (m) {
      if (m.cooldown <= 0) {
        m.cooldown = this.config.mortarCooldown
        const mortarPr = createProjectile(this.prj++, p, m.x + Math.cos(m.angle) * 34, m.y - 18 + Math.sin(m.angle) * 34,
          Math.cos(m.angle) * m.power * 60, Math.sin(m.angle) * m.power * 60,
          { damage: this.config.mortarDamage, headshotMult: 1.5, terrainRadius: this.config.mortarRadius, explosive: true, gravityScale: 0.68, weaponLabel: '公共迫击炮', color: '#f97316', r: 7.5, life: 175 / 60 })
        this.projectiles.push(mortarPr)
        this.events.push({
          kind: 'projectile_spawn', projectileId: mortarPr.id, playerId: p.id, weaponId: -1,
          x: mortarPr.pos.x, y: mortarPr.pos.y, vx: mortarPr.vel.x, vy: mortarPr.vel.y,
          bounces: 0, life: mortarPr.life,
        })
        this.events.push({ kind: 'mortar_fire', x: m.x, y: m.y, playerId: p.id })
      }
      return
    }
    const wep = WEAPONS[p.weaponIndex]
    // 逐发装填的武器（霰弹）：装填中有子弹就能随时击发（击发会打断装填）
    const canFireWhileReloading = !!wep.shellReload && p.ammo[p.weaponIndex] > 0
    if ((p.reloading && !canFireWhileReloading) || p.fireCooldown > 0) return
    if (p.ammo[p.weaponIndex] <= 0) {
      if ((p.reserveAmmo[p.weaponIndex] || 0) > 0) this.startReload(p)
      return
    }
    // 逐发装填：击发时中断装填进程（下次开火若弹匣未满会重新开始装填）
    if (wep.shellReload && p.reloading) p.reloading = false
    p.ammo[p.weaponIndex]--
    p.fireCooldown = wep.fireDelay
    // 自动装填：弹匣打空必装；逐发装填的武器（霰弹）只要没装满就继续装
    const needReload = wep.shellReload
      ? p.ammo[p.weaponIndex] < wep.magSize
      : p.ammo[p.weaponIndex] <= 0
    if (needReload && (p.reserveAmmo[p.weaponIndex] || 0) > 0) this.startReload(p)

    if (wep.recoil > 0) {
      const rk = recoilDelta(wep.recoil, p.aim)
      if (!p.recoilVel) p.recoilVel = { x: 0, y: 0 }
      p.recoilVel.x = rk.x
      p.recoilVel.y = rk.y
    }

    const mx = wrapX(p.pos.x + Math.cos(p.aim) * 24)
    const my = (p.pos.y - 12) + Math.sin(p.aim) * 24
    for (let i = 0; i < wep.pellets; i++) {
      const spreadA = p.aim + this.rng.range(-wep.spread / 2, wep.spread / 2)
      const spd = wep.speed * (wep.pellets > 1 ? this.rng.range(0.88, 1.12) : 1)
      const pr = createProjectile(this.prj++, p, mx, my, Math.cos(spreadA) * spd, Math.sin(spreadA) * spd, {
        damage: wep.damage, headshotMult: wep.headshotMult, terrainRadius: wep.terrainRadius,
        explosive: wep.explosive, gravityScale: wep.gravityScale ?? (wep.id === 4 ? 0.0 : 0.04),
        pierceOnHeadshot: !!wep.pierceOnHeadshot, pierceAll: !!wep.pierceAll,
        isGravityOrb: !!wep.isGravityOrb, bounces: wep.bounces ?? 0, passWalls: !!wep.passWalls, beam: !!wep.beam, rocket: !!wep.rocket,
        dragPerSecond: wep.dragPerSecond ?? 1,
        weaponId: wep.id, curveRate: wep.curveRate ?? 0, weaponLabel: wep.shortName, color: wep.color,
        r: wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2,
        life: wep.lifeSeconds ?? (wep.id === 2 || wep.id === 4 ? 175 : 130) / 60,
      })
      this.projectiles.push(pr)
      this.events.push({
        kind: 'projectile_spawn', projectileId: pr.id, playerId: p.id, weaponId: pr.weaponId,
        x: pr.pos.x, y: pr.pos.y, vx: pr.vel.x, vy: pr.vel.y, bounces: pr.bounces, life: pr.life,
      })
      if (pr.isGravityOrb && pr.life > 0 && pr.damage > 0) this.activeGravityOrbs.push(pr)
    }
  }

  snapshot(): WorldSnapshot {
    return {
      tick: this.tick,
      seed: this.seed,
      players: this.players.map(p => ({
        ...p,
        pos: { x: p.pos.x, y: p.pos.y }, vel: { x: p.vel.x, y: p.vel.y },
        ammo: [...p.ammo], reserveAmmo: [...p.reserveAmmo],
        teleportTarget: p.teleportTarget ? { x: p.teleportTarget.x, y: p.teleportTarget.y } : null,
        doll: p.doll ? { ...p.doll, pos: { x: p.doll.pos.x, y: p.doll.pos.y }, ammo: [...p.doll.ammo], reserveAmmo: [...p.doll.reserveAmmo] } : null,
      })),
      projectiles: this.projectiles.map(pr => ({ ...pr, pos: { x: pr.pos.x, y: pr.pos.y }, vel: { x: pr.vel.x, y: pr.vel.y }, hitTargets: [...pr.hitTargets] })),
      grenades: this.grenades.map(g => ({ ...g, pos: { x: g.pos.x, y: g.pos.y }, vel: { x: g.vel.x, y: g.vel.y } })),
      landmines: this.landmines.map(m => ({ ...m, pos: { x: m.pos.x, y: m.pos.y }, vel: { x: m.vel.x, y: m.vel.y } })),
      airstrikes: this.airstrikes.map(a => ({ ...a, pos: { x: a.pos.x, y: a.pos.y } })),
      obstacles: this.obstacles.map(o => ({ ...o })),
      capturePoints: this.capturePoints.map(c => ({ ...c })),
      ammoPacks: this.ammoPacks.map(a => ({ ...a })),
      supplyCrates: this.supplyCrates.map(c => ({ ...c })),
      mortars: this.mortars.map(m => ({ ...m })),
      scores: { ...this.scores },
    }
  }
}
