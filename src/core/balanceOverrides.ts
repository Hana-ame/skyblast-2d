// core/balanceOverrides.ts —— 数值调整后台（admin.html）与游戏主页面共享的 localStorage 覆盖层
// 只存「相对默认值的差分」，并提供纯函数做：清洗（防 NaN/越界）+ 应用到 WEAPONS / DEFAULT_CONFIG / PHYSICS
import { WEAPONS, DEFAULT_CONFIG } from './weapons.ts'
import type { WeaponDef, GameConfig } from './weapons.ts'

export const OVERRIDES_STORAGE_KEY = 'skyblast_balance_overrides_v1'
export const LEGACY_BALANCE_KEY = 'pvp-balance-overrides-v1'
/** 兼容既有 localStorage key（游戏/后台/文档统一用这个） */
export const BALANCE_KEY = OVERRIDES_STORAGE_KEY

export interface BalanceOverrides {
  weapons?: Record<string, Partial<WeaponDef>>
  config?: Partial<GameConfig>
  physics?: Record<string, number>
}

export const WEAPON_NUMERIC_KEYS: (keyof WeaponDef)[] = [
  'damage', 'grazeDamageMin', 'headshotMult', 'pellets', 'spread', 'speed', 'recoil',
  'magSize', 'maxReserve', 'reloadTime', 'fireDelay', 'terrainRadius', 'blastFalloffExponent',
  'gravityScale', 'bounces', 'dragPerSecond', 'chargeSeconds',
  'damagePerSecond', 'ammoPerSecond',
  'moveSpeedMult', 'fuelMult', 'ascendMult', 'fovMult',
  'falloffStart', 'falloffEnd', 'falloffMin', 'lifeSeconds', 'farRange', 'farDamage', 'edgeDamage',
]
export const WEAPON_BOOL_KEYS: (keyof WeaponDef)[] = [
  'explosive', 'pierceOnHeadshot', 'pierceAll', 'passWalls', 'friendlyFire', 'selfDamage',
  // 机制开关（此前调不到）：逐发装填/激光/火箭/光束/引力球/额外副武器槽
  'shellReload', 'laser', 'rocket', 'beam', 'isGravityOrb', 'extraSecondarySlot',
]

/** 物理参数可调键：必须与 core/sim/physics.ts 的 PhysicsParams 字段**完全一致**。
 *  历史 bug：这里曾写死 6 个且其中 jumpVelocity / jetpackThrust 根本不是真实字段名
 *  （真名是 jumpImpulse / jetpackAccel），导致后台调了参数却在保存清洗时被丢弃、
 *  重启游戏不生效；同时 mass / maxFall / jetpackDrain / jetpackRecharge 完全调不到。 */
export const PHYSICS_KEYS = [
  'mass', 'gravity', 'moveSpeed', 'jumpImpulse', 'maxFall',
  'jetpackAccel', 'jetpackMaxUp', 'jetpackFuel', 'jetpackDrain', 'jetpackRecharge',
] as const
export type PhysicsKey = (typeof PHYSICS_KEYS)[number]
const PHYSICS_BOUNDS: Partial<Record<PhysicsKey, [number, number]>> = {
  mass: [0.1, 20], gravity: [-5000, 10000], moveSpeed: [0, 3000],
  jumpImpulse: [0, 3000], maxFall: [0, 6000],
  jetpackAccel: [0, 20000], jetpackMaxUp: [0, 3000],
  jetpackFuel: [0.01, 20], jetpackDrain: [0.01, 50], jetpackRecharge: [0, 50],
}

export const CONFIG_NUMERIC_KEYS: (keyof GameConfig)[] = [
  'maxHp', 'respawnDelay', 'headRadius', 'grenadeDamage', 'grenadeRadius', 'grenadeFuse',
  'fragMaxCharges', 'fragRechargeSeconds', 'dollMaxCharges', 'dollDuration',
  'shieldHp', 'shieldDuration', 'obstacleDefaultHp', 'teleportCastTime',
  'mortarDamage', 'mortarRadius', 'watchtowerDuration', 'watchtowerFovMult',
  // 此前缺失：地雷 / 空袭 / 迫击炮冷却 / 手枪基础值 / 占点 / 弹药补给
  'mineDamage', 'mineTriggerRadius', 'mineRespawnTime',
  'airstrikeDamage', 'airstrikeRadius', 'mortarCooldown',
  'pistolDamage', 'pistolHeadshotMult',
  'captureRadius', 'captureRate',
  'ammoPackInterval', 'ammoPackMaxActive', 'supplyRespawnTime',
]
export const CONFIG_BOOL_KEYS: (keyof GameConfig)[] = ['randomSpawn', 'loadoutLock', 'grenadeFriendlyFire', 'grenadeSelfDamage']

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

const WEAPON_BOUNDS: Partial<Record<keyof WeaponDef, [number, number]>> = {
  damage: [0, 2000], grazeDamageMin: [0, 2000], headshotMult: [0.5, 10], pellets: [1, 32], spread: [0, 1.5],
  speed: [50, 10000], recoil: [0, 5000], magSize: [1, 500], maxReserve: [0, 2000],
  reloadTime: [0.05, 30], fireDelay: [0, 10], terrainRadius: [0, 400], blastFalloffExponent: [0.5, 5],
  gravityScale: [0, 5], bounces: [0, 16], dragPerSecond: [0.05, 1], chargeSeconds: [0, 5],
  damagePerSecond: [0, 5000], ammoPerSecond: [0.1, 200],
  moveSpeedMult: [0.1, 5], fuelMult: [0.1, 5], ascendMult: [0.1, 5], fovMult: [1, 2],
  falloffStart: [0, 5000], falloffEnd: [1, 10000], falloffMin: [0, 1],
  lifeSeconds: [0.05, 9999], farRange: [50, 10000], farDamage: [0, 2000], edgeDamage: [0, 2000],
}

export function sanitizeOverrides(raw: unknown): BalanceOverrides | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: BalanceOverrides = {}

  if (r.weapons && typeof r.weapons === 'object') {
    const wOut: Record<string, Partial<WeaponDef>> = {}
    for (const [idStr, patch] of Object.entries(r.weapons as Record<string, unknown>)) {
      const id = Number(idStr)
      if (!Number.isInteger(id) || id < 0 || id >= WEAPONS.length) continue
      if (!patch || typeof patch !== 'object') continue
      const p = patch as Record<string, unknown>
      const clean: Partial<WeaponDef> = {}
      for (const k of WEAPON_NUMERIC_KEYS) {
        if (k in p) {
          const n = num(p[k])
          if (n !== null) {
            const b = WEAPON_BOUNDS[k] ?? [-1e6, 1e6]
            ;(clean as Record<string, number>)[k] = clamp(n, b[0], b[1])
          }
        }
      }
      for (const k of WEAPON_BOOL_KEYS) {
        if (typeof p[k] === 'boolean') (clean as Record<string, boolean>)[k] = p[k] as boolean
      }
      if (Object.keys(clean).length > 0) wOut[String(id)] = clean
    }
    if (Object.keys(wOut).length > 0) out.weapons = wOut
  }

  if (r.config && typeof r.config === 'object') {
    const c = r.config as Record<string, unknown>
    const clean: Partial<GameConfig> = {}
    for (const k of CONFIG_NUMERIC_KEYS) {
      if (k in c) {
        const n = num(c[k])
        if (n !== null) (clean as Record<string, number>)[k] = clamp(n, 0, 1e6)
      }
    }
    for (const k of CONFIG_BOOL_KEYS) {
      if (typeof c[k] === 'boolean') (clean as Record<string, boolean>)[k] = c[k] as boolean
    }
    if (Object.keys(clean).length > 0) out.config = clean
  }

  if (r.physics && typeof r.physics === 'object') {
    const ph = r.physics as Record<string, unknown>
    const clean: Record<string, number> = {}
    for (const k of PHYSICS_KEYS) {
      if (k in ph) {
        const n = num(ph[k])
        if (n !== null) {
          const b = PHYSICS_BOUNDS[k] ?? [-5000, 10000]
          clean[k] = clamp(n, b[0], b[1])
        }
      }
    }
    if (Object.keys(clean).length > 0) out.physics = clean
  }

  return Object.keys(out).length > 0 ? out : null
}

export function applyWeaponOverrides(patches?: Record<string, Partial<WeaponDef>>): void {
  if (!patches) return
  for (const [idStr, p] of Object.entries(patches)) {
    const w = WEAPONS[Number(idStr)]
    if (w && p) Object.assign(w, p)
  }
}

export function applyConfigOverrides(target: GameConfig, patch?: Partial<GameConfig>): void {
  if (!patch) return
  Object.assign(target, patch)
}

export function loadStoredOverrides(): BalanceOverrides | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY)
    if (!raw) return null
    return sanitizeOverrides(JSON.parse(raw))
  } catch {
    return null
  }
}

export const DEFAULT_WEAPONS_SNAPSHOT: WeaponDef[] = WEAPONS.map(w => ({ ...w }))
export const DEFAULT_CONFIG_SNAPSHOT: GameConfig = { ...DEFAULT_CONFIG }
