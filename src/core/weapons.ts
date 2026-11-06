// core/weapons.ts —— 武器库（移植 SkyBlast v2 src/core/constants.js，秒制化）
// v2 是"每帧像素 @60fps"（px/frame），骨架是秒制（px/s）——速度×60、（隐式重力项）×3600。
export interface WeaponDef {
  id: number
  name: string
  shortName: string
  isSupplyOnly: boolean
  damage: number
  headshotMult: number
  pellets: number
  spread: number           // 弧度
  speed: number            // px/s（秒制）
  recoil: number           // px/s 冲量
  magSize: number
  maxReserve: number
  reloadTime: number       // 秒
  fireDelay: number        // 秒
  terrainRadius: number    // 爆炸半径（explosive 时生效）
  explosive: boolean
  laser?: boolean
  pierceOnHeadshot?: boolean
  pierceAll?: boolean
  gravityScale?: number    // 弹道重力缩放（0=直线）
  isGravityOrb?: boolean
  fovMult?: number
  color: string
}

export interface SecondaryDef {
  id: string
  name: string
  icon: string
  cd: number
}

// v2 speed: 16→960, 20→1200, 34→2040, 15.5→930, 44→2640, 22→1320, 13.5→810
// recoil×60：13.5→810, 1.4→84, 6.5→390, 8.5→510, 2.5→150, 1.1→66, 4.0→240
export const WEAPONS: WeaponDef[] = [
  {
    id: 0, name: '推进霰弹枪', shortName: '霰弹枪', isSupplyOnly: false,
    damage: 15, headshotMult: 1.8, pellets: 8, spread: 0.28,
    speed: 960, recoil: 810, magSize: 6, maxReserve: 30,
    reloadTime: 1.5, fireDelay: 0.50, terrainRadius: 12,
    explosive: false, pierceOnHeadshot: false, fovMult: 1.0, color: '#fbbf24',
  },
  {
    id: 1, name: '脉冲突击步枪', shortName: '突击步枪', isSupplyOnly: false,
    damage: 19, headshotMult: 2.2, pellets: 1, spread: 0.045,
    speed: 1200, recoil: 84, magSize: 28, maxReserve: 140,
    reloadTime: 1.7, fireDelay: 0.12, terrainRadius: 8,
    explosive: false, pierceOnHeadshot: false, fovMult: 1.0, color: '#38bdf8',
  },
  {
    id: 2, name: '电磁狙击步枪', shortName: '电磁狙击', isSupplyOnly: false,
    damage: 68, headshotMult: 2.5, pellets: 1, spread: 0.003,
    speed: 2040, recoil: 390, magSize: 5, maxReserve: 25,
    reloadTime: 2.3, fireDelay: 0.92, terrainRadius: 16,
    explosive: false, laser: true, pierceOnHeadshot: true, fovMult: 1.30, color: '#c084fc',
  },
  {
    id: 3, name: '重型榴弹炮', shortName: '榴弹炮', isSupplyOnly: false,
    damage: 68, headshotMult: 1.5, pellets: 1, spread: 0.025,
    speed: 930, recoil: 510, magSize: 4, maxReserve: 20,
    reloadTime: 2.4, fireDelay: 0.75, terrainRadius: 72,
    explosive: true, gravityScale: 0.45, pierceOnHeadshot: false, fovMult: 1.0, color: '#fb7185',
  },
  {
    id: 4, name: '⚡ 聚变激光炮', shortName: '激光炮', isSupplyOnly: true,
    damage: 45, headshotMult: 2.0, pellets: 1, spread: 0.001,
    speed: 2640, recoil: 150, magSize: 12, maxReserve: 24,
    reloadTime: 2.0, fireDelay: 0.26, terrainRadius: 18,
    explosive: false, laser: true, pierceAll: true, pierceOnHeadshot: true, fovMult: 1.15, color: '#22d3ee',
  },
  {
    id: 5, name: '🔥 重装加特林', shortName: '加特林', isSupplyOnly: true,
    damage: 14, headshotMult: 1.8, pellets: 1, spread: 0.11,
    speed: 1320, recoil: 66, magSize: 90, maxReserve: 180,
    reloadTime: 2.8, fireDelay: 0.055, terrainRadius: 8,
    explosive: false, pierceOnHeadshot: false, fovMult: 1.0, color: '#f97316',
  },
  {
    id: 6, name: '🌀 奇点引力枪', shortName: '引力枪', isSupplyOnly: true,
    damage: 52, headshotMult: 1.6, pellets: 1, spread: 0.01,
    speed: 810, recoil: 240, magSize: 6, maxReserve: 18,
    reloadTime: 2.2, fireDelay: 0.68, terrainRadius: 95,
    explosive: true, isGravityOrb: true, gravityScale: 0.08, pierceOnHeadshot: false, fovMult: 1.1, color: '#a855f7',
  },
]

// 8 种战术副武器（v2 全量）；pistol 有独立弹匣/备弹
export const SECONDARIES: Record<string, SecondaryDef> = {
  frag:         { id: 'frag',         name: '手榴弹',     icon: '💣', cd: 10.0 },
  mine:         { id: 'mine',         name: '感应地雷',   icon: '🚨', cd: 14.0 },
  instant_mine: { id: 'instant_mine', name: '瞬发地雷',   icon: '⚡', cd: 15.0 },
  airstrike:    { id: 'airstrike',    name: '定点空袭',   icon: '✈️', cd: 20.0 },
  barricade:    { id: 'barricade',    name: '可破坏障碍物', icon: '🧱', cd: 12.0 },
  shield:       { id: 'shield',       name: '一次性护盾', icon: '🛡️', cd: 16.0 },
  doll:         { id: 'doll',         name: '替身人偶',   icon: '🎎', cd: 24.0 },
  pistol:       { id: 'pistol',       name: '战术手枪',   icon: '🔫', cd: 0.24 },
}

/** 全局玩法参数（服务器可调；随 hello/config_event 同步） */
export interface GameConfig {
  maxHp: number
  headRadius: number
  shieldHp: number
  shieldDuration: number
  dollDuration: number
  obstacleDefaultHp: number
  grenadeDamage: number
  grenadeRadius: number
  grenadeFuse: number
  mineDamage: number
  mineTriggerRadius: number
  mineRespawnTime: number
  airstrikeDamage: number
  airstrikeRadius: number
  mortarDamage: number
  mortarRadius: number
  mortarCooldown: number
  pistolDamage: number
  pistolHeadshotMult: number
  captureRadius: number
  captureRate: number       // 每人每秒进度
  ammoPackInterval: number   // 弹药点刷新间隔（秒）
  ammoPackMaxActive: number
  supplyRespawnTime: number
  watchtowerDuration: number
  watchtowerFovMult: number
  respawnDelay: number
  loadoutLock: boolean        // v2 规则：部署后锁定配装，仅重生前可换
}

export const DEFAULT_CONFIG: GameConfig = {
  maxHp: 100,
  headRadius: 13,
  shieldHp: 130,
  shieldDuration: 5.0,
  dollDuration: 10.0,
  obstacleDefaultHp: 240,
  grenadeDamage: 105,
  grenadeRadius: 90,
  grenadeFuse: 1.65,
  mineDamage: 110,
  mineTriggerRadius: 48,
  mineRespawnTime: 14,
  airstrikeDamage: 88,
  airstrikeRadius: 80,
  mortarDamage: 130,
  mortarRadius: 105,
  mortarCooldown: 2.2,
  pistolDamage: 25,
  pistolHeadshotMult: 2.0,
  captureRadius: 135,
  captureRate: 28,
  ammoPackInterval: 7.0,
  ammoPackMaxActive: 8,
  supplyRespawnTime: 22,
  watchtowerDuration: 20,
  watchtowerFovMult: 1.65,
  respawnDelay: 4.0,
  loadoutLock: true,
}
