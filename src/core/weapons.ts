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
  bounces?: number         // 撞墙反弹次数（激光 2 次）
  passWalls?: boolean      // 穿透原始地形（引力弹）
  dragPerSecond?: number   // 每秒速度保留比例（<1 表示逐渐减速；引力弹）
  beam?: boolean           // 渲染为光束（激光）
  farRange?: number        // 远距阈值：超过该距离命中按 farDamage 结算（狙击）
  farDamage?: number       // 超过 farRange 时的伤害（狙击 99，非爆头留 1 血）
  chargeSeconds?: number   // 开火蓄力时间（狙击等慢速重型武器）
  damagePerSecond?: number // 持续光束每秒伤害（beam 武器）
  ammoPerSecond?: number   // 持续光束每秒耗弹（beam 武器）
  rocket?: boolean         // 渲染为火箭弹（直线慢速爆炸弹）
  isGravityOrb?: boolean
  fovMult?: number
  moveSpeedMult?: number // 持有时移动速度倍率（重武器更慢）
  fuelMult?: number      // 持有时飞行续航倍率（重武器飞行距离更短）
  lifeSeconds?: number  // 弹丸存活时间（射程）：默认按武器给，999 = 无限射程
  color: string
}

export interface SecondaryDef {
  id: string
  name: string
  icon: string
  cd: number
  /** true = 只能从战场特殊补给箱获得，不在常规配装可选列表 */
  supplyOnly?: boolean
}

// v2 speed: 16→960, 20→1200, 34→2040, 15.5→930, 44→2640, 22→1320, 13.5→810
// recoil×60：13.5→810, 1.4→84, 6.5→390, 8.5→510, 2.5→150, 1.1→66, 4.0→240
export const WEAPONS: WeaponDef[] = [
  {
    id: 0, name: '霰弹枪', shortName: '霰弹', isSupplyOnly: false,
    damage: 13, headshotMult: 1.0, pellets: 8, spread: 0.24,
    speed: 1000, recoil: 780, magSize: 6, maxReserve: 30,
    reloadTime: 1.5, fireDelay: 0.90, terrainRadius: 12,
    explosive: false, pierceOnHeadshot: false, moveSpeedMult: 1.08, fuelMult: 1.05, fovMult: 1.0, color: '#fbbf24',
  },
  {
    id: 1, name: '突击步枪', shortName: '突击步枪', isSupplyOnly: false,
    damage: 23, headshotMult: 2.2, pellets: 1, spread: 0.045,
    speed: 1500, recoil: 84, magSize: 28, maxReserve: 140,
    reloadTime: 1.7, fireDelay: 0.12, terrainRadius: 8,
    explosive: false, pierceOnHeadshot: false, moveSpeedMult: 1.0, fuelMult: 1.0, fovMult: 1.0, color: '#38bdf8',
  },
  {
    id: 2, name: '狙击步枪', shortName: '狙', isSupplyOnly: false,
    damage: 100, headshotMult: 2.5, pellets: 1, spread: 0.003,
    speed: 4000, recoil: 390, magSize: 3, maxReserve: 15,
    reloadTime: 2.8, fireDelay: 0.95, chargeSeconds: 0.60, terrainRadius: 16,
    explosive: false, laser: true, pierceOnHeadshot: true, lifeSeconds: 999, moveSpeedMult: 0.6, fuelMult: 0.6, fovMult: 1.30, color: '#c084fc',
    farRange: 800, farDamage: 99,   // 超过视距的非爆头命中只造成 99（留 1 血）
  },
  {
    id: 3, name: '火箭筒', shortName: '火箭筒', isSupplyOnly: false,
    damage: 115, headshotMult: 1.5, pellets: 1, spread: 0.0,
    speed: 520, recoil: 420, magSize: 1, maxReserve: 20,   // 1 发/弹匣，共 20 个弹匣；换弹 2s
    reloadTime: 2.0, fireDelay: 0, terrainRadius: 124,   // 射击间隔 = 0（节奏由 2s 换弹决定）
    explosive: true, gravityScale: 0, lifeSeconds: 999, rocket: true, pierceOnHeadshot: false, moveSpeedMult: 0.5, fuelMult: 0.5, fovMult: 1.0, color: '#fb7185',
  },
  {
    id: 4, name: '激光', shortName: '激光', isSupplyOnly: true,
    damage: 50, headshotMult: 2.0, pellets: 1, spread: 0.0,
    speed: 3000, recoil: 0, magSize: 48, maxReserve: 96,   // 48 / 6每秒 = 连续 8 秒
    reloadTime: 2.0, fireDelay: 0, terrainRadius: 18,
    explosive: false, laser: true, pierceAll: true, pierceOnHeadshot: true, bounces: 3, beam: true,
    damagePerSecond: 150, ammoPerSecond: 6, moveSpeedMult: 0.95, fuelMult: 1.0, fovMult: 1.30, color: '#22d3ee',
  },
  {
    id: 5, name: 'M249', shortName: 'M249', isSupplyOnly: true,
    damage: 23, headshotMult: 1.8, pellets: 1, spread: 0.11,
    speed: 1300, recoil: 66, magSize: 120, maxReserve: 240,
    reloadTime: 3.0, fireDelay: 0.045, terrainRadius: 8,
    explosive: false, pierceOnHeadshot: false, moveSpeedMult: 0.78, fuelMult: 0.7, fovMult: 1.30, color: '#f97316',
  },
  {
    id: 6, name: '引力枪', shortName: '引力枪', isSupplyOnly: true,
    damage: 30, headshotMult: 1.6, pellets: 1, spread: 0.01,
    speed: 900, recoil: 240, magSize: 6, maxReserve: 18,
    reloadTime: 2.2, fireDelay: 1.10, terrainRadius: 95, lifeSeconds: 2.2,
    explosive: true, isGravityOrb: true, gravityScale: 0.02, passWalls: true, dragPerSecond: 0.45,
    pierceOnHeadshot: false, moveSpeedMult: 0.86, fuelMult: 0.8, fovMult: 1.30, color: '#a855f7',
  },
  {
    id: 7, name: '手枪', shortName: '手枪', isSupplyOnly: false,
    damage: 24, headshotMult: 2.0, pellets: 1, spread: 0.090,
    speed: 1500, recoil: 60, magSize: 12, maxReserve: 48,
    reloadTime: 0.9, fireDelay: 0.17, terrainRadius: 6,
    explosive: false, gravityScale: 0.03, pierceOnHeadshot: false,
    moveSpeedMult: 2.00, fuelMult: 2.00, fovMult: 1.0, color: '#fde047',   // 双倍移速/双倍飞行
  },
  {
    id: 8, name: '冲锋枪', shortName: '冲锋枪', isSupplyOnly: false,
    damage: 24, headshotMult: 1.8, pellets: 1, spread: 0.24,   // 伤害 = 手枪；极高射速用大散布/弹匣平衡
    speed: 1500, recoil: 48, magSize: 30, maxReserve: 150,
    reloadTime: 2.2, fireDelay: 0.05, terrainRadius: 8,        // 射速极高
    explosive: false, gravityScale: 0.04, pierceOnHeadshot: false,
    moveSpeedMult: 1.5, fuelMult: 1.0, fovMult: 1.0, color: '#4ade80',
  },
]

// 战术副武器：只保留手榴弹（2 充能、自然回复）；替身人偶为特殊补给专属（不占配装槽）
export const SECONDARIES: Record<string, SecondaryDef> = {
  frag: { id: 'frag', name: '手榴弹', icon: '💣', cd: 0.8 },
  doll: { id: 'doll', name: '替身人偶', icon: '🎎', cd: 24.0, supplyOnly: true },
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
  loadoutLock: boolean
  randomSpawn: boolean     // 死亡竞赛：每次出生在随机安全点
  fragMaxCharges: number   // 手雷最大充能数（自然回复）
  fragRechargeSeconds: number  // 每充能回复秒数
  dollMaxCharges: number    // 替身人偶最多可囤几个（只从补给箱获得）        // v2 规则：部署后锁定配装，仅重生前可换
}

export const DEFAULT_CONFIG: GameConfig = {
  maxHp: 100,
  headRadius: 13,
  shieldHp: 130,
  shieldDuration: 5.0,
  dollDuration: 10.0,
  obstacleDefaultHp: 240,
  grenadeDamage: 520,   // 一发致死：最远衰减(0.2)也有 104 伤害
  grenadeRadius: 100,
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
  randomSpawn: false,
  fragMaxCharges: 2,
  fragRechargeSeconds: 6.0,
  dollMaxCharges: 2,
}
