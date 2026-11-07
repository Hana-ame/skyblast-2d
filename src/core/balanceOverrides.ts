// core/balanceOverrides.ts —— 数值调整后台：武器/全局/物理参数覆盖（localStorage → 游戏启动时应用）
import { WEAPONS, DEFAULT_CONFIG } from './weapons.ts'
import type { WeaponDef, GameConfig } from './weapons.ts'

export interface BalanceOverrides {
  weapons?: Record<string, Partial<Record<keyof WeaponDef, number | boolean | string>>>
  config?: Partial<GameConfig>
  physics?: Record<string, number>
}

export const BALANCE_KEY = 'pvp-balance-overrides-v1'

export const WEAPON_NUMERIC_KEYS: (keyof WeaponDef)[] = [
  'damage', 'headshotMult', 'pellets', 'spread', 'speed', 'recoil',
  'magSize', 'maxReserve', 'reloadTime', 'fireDelay', 'terrainRadius',
  'gravityScale', 'chargeSeconds', 'damagePerSecond', 'ammoPerSecond',
  'moveSpeedMult', 'fuelMult', 'ascendMult', 'fovMult',
  'falloffStart', 'falloffEnd', 'falloffMin', 'lifeSeconds', 'farRange', 'farDamage',
]
export const WEAPON_BOOL_KEYS: (keyof WeaponDef)[] = ['explosive', 'pierceOnHeadshot', 'pierceAll', 'passWalls']

export const CONFIG_NUMERIC_KEYS: (keyof GameConfig)[] = [
  'maxHp', 'respawnDelay', 'headRadius', 'grenadeDamage', 'grenadeRadius', 'grenadeFuse',
  'fragMaxCharges', 'fragRechargeSeconds', 'dollMaxCharges', 'dollDuration',
  'mortarDamage', 'mortarRadius', 'watchtowerDuration', 'watchtowerFovMult',
]
export const CONFIG_BOOL_KEYS: (keyof GameConfig)[] = ['randomSpawn', 'loadoutLock']

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 清洗外部覆盖 JSON：只认武器/配置的已知数值键，并做基本范围夹取 */
export function sanitizeOverrides(raw: unknown): BalanceOverrides | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const out: BalanceOverrides = {}
  if (o.weapons && typeof o.weapons === 'object') {
    const weapons: BalanceOverrides['weapons'] = {}
    for (const [k, v] of Object.entries(o.weapons as Record<string, unknown>)) {
      const id = Number(k)
      if (!Number.isInteger(id) || id < 0 || id >= WEAPONS.length) continue
      if (!v || typeof v !== 'object') continue
      const patch: Partial<Record<keyof WeaponDef, number | boolean | string>> = {}
      for (const key of WEAPON_NUMERIC_KEYS) {
        const n = num((v as Record<string, unknown>)[key])
        if (n === null) continue
        // 夹取：避免后台误填把游戏弄坏
        if (key === 'damage' || key === 'damagePerSecond') patch[key] = Math.max(0, Math.min(5000, n))
        else if (key === 'magSize') patch[key] = Math.max(1, Math.min(500, Math.round(n)))
        else if (key === 'maxReserve') patch[key] = Math.max(0, Math.min(2000, Math.round(n)))
        else if (key === 'pellets') patch[key] = Math.max(1, Math.min(30, Math.round(n)))
        else if (key === 'reloadTime' || key === 'fireDelay' || key === 'chargeSeconds') patch[key] = Math.max(0, Math.min(20, n))
        else if (key === 'moveSpeedMult' || key === 'fuelMult' || key === 'ascendMult' || key === 'fovMult') patch[key] = Math.max(0, Math.min(5, n))
        else patch[key] = n
      }
      for (const key of WEAPON_BOOL_KEYS) {
        const b = (v as Record<string, unknown>)[key]
        if (typeof b === 'boolean') patch[key] = b
      }
      if (Object.keys(patch).length > 0) weapons[String(id)] = patch
    }
    if (Object.keys(weapons).length > 0) out.weapons = weapons
  }
  if (o.config && typeof o.config === 'object') {
    const config: Partial<GameConfig> = {}
    for (const key of CONFIG_NUMERIC_KEYS) {
      const n = num((o.config as Record<string, unknown>)[key])
      if (n !== null) (config as Record<string, number>)[key as string] = n
    }
    for (const key of CONFIG_BOOL_KEYS) {
      const b = (o.config as Record<string, unknown>)[key]
      if (typeof b === 'boolean') (config as Record<string, boolean>)[key as string] = b
    }
    if (Object.keys(config).length > 0) out.config = config
  }
  if (o.physics && typeof o.physics === 'object') {
    const physics: Record<string, number> = {}
    for (const [k, v] of Object.entries(o.physics as Record<string, unknown>)) {
      const n = num(v)
      if (n !== null) physics[k] = n
    }
    if (Object.keys(physics).length > 0) out.physics = physics
  }
  if (!out.weapons && !out.config && !out.physics) return null
  return out
}

/** 把武器覆盖应用到全局 WEAPONS（游戏/对射模拟共用） */
export function applyWeaponOverrides(ov?: BalanceOverrides['weapons']): void {
  if (!ov) return
  for (const [k, patch] of Object.entries(ov)) {
    const id = Number(k)
    const wep = WEAPONS[id]
    if (!wep || !patch) continue
    Object.assign(wep, patch)
  }
}

/** 合并全局配置覆盖到给定 config（World 实例创建后调用） */
export function applyConfigOverrides(config: GameConfig, ov?: Partial<GameConfig>): void {
  if (!ov) return
  Object.assign(config, ov)
}
