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
  bounces?: number         // 撞墙反弹次数（高斯枪 2 次）
  passWalls?: boolean      // 穿透原始地形（引力弹）
  dragPerSecond?: number   // 每秒速度保留比例（<1 表示逐渐减速；引力弹）
  beam?: boolean           // 渲染为光束（高斯枪）
  ascendMult?: number      // 升空速度倍率（喷气上升速度）
  falloffStart?: number     // 距离衰减起点（px，之前满伤）
  falloffEnd?: number       // 距离衰减终点（px，之后为 falloffMin）
  falloffMin?: number       // 距离衰减最小倍率
  curveRate?: number       // 弹道弯曲速率 rad/s（引力枪的弯曲弹道）
  farRange?: number        // 远距阈值（可选）
  farDamage?: number       // 超过 farRange 时的伤害（可选）
  edgeDamage?: number      // 命中身体碰撞箱边缘（擦边）时的伤害（狙击 = 99，正常命中身体与远距身体均为 100）
  /** 分级擦边伤害：命中身体主体 = damage，越靠碰撞箱边缘越低，线性落到 grazeDamageMin。
   *  （突击步枪 37 → 擦边最低 30，常见命中 33~34） */
  grazeDamageMin?: number
  chargeSeconds?: number   // 开火蓄力时间（狙击等慢速重型武器）
  friendlyFire?: boolean   // 是否对友军造成伤害（默认 false=关闭；手雷/高斯/引力/火箭开启）
  selfDamage?: boolean     // 是否会对使用者自己造成伤害（默认 false；高斯反射光束等开启）
  damagePerSecond?: number // 持续光束每秒伤害（beam 武器）
  ammoPerSecond?: number   // 持续光束每秒耗弹（beam 武器）
  rocket?: boolean         // 渲染为火箭弹（直线慢速爆炸弹）
  isGravityOrb?: boolean
  fovMult?: number
  moveSpeedMult?: number // 持有时移动速度倍率（重武器更慢）
  fuelMult?: number      // 持有时飞行续航倍率（重武器飞行距离更短）
  lifeSeconds?: number  // 弹丸存活时间（射程）：默认按武器给，999 = 无限射程
  /** 统一 UI 特性简述（与弹匣/备弹组合生成配装卡片文案） */
  traitDesc?: string
  color: string
}

export interface SecondaryDef {
  id: string
  name: string
  icon: string
  cd: number
  /** 连续死亡多少次后解锁（0 = 默认初始解锁） */
  unlockStreak: number
  /** 简短平衡性说明（UI 展示） */
  desc?: string
  /** true = 初始不在常规配装可选列表，需连死阶梯解锁或战场特殊补给箱获得 */
  supplyOnly?: boolean
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 0, name: '霰弹枪', shortName: '霰弹', isSupplyOnly: false,
    damage: 24, headshotMult: 1.0, pellets: 8, spread: 0.24,   // 伤害=手枪弹
    speed: 1000, recoil: 1560, magSize: 8, maxReserve: 72,   // 后坐力 ×2
    reloadTime: 1.5, fireDelay: 0.58, terrainRadius: 12,     // 射速略微提升（0.72 -> 0.58s）
    explosive: false, pierceOnHeadshot: false, moveSpeedMult: 1.08, fuelMult: 1.05, fovMult: 1.0, color: '#fbbf24',
    falloffStart: 200, falloffEnd: 700, falloffMin: 0.45,   // 霰弹随距离衰减（中距仍可用）
    traitDesc: '近距高伤 · 全中致死',
  },
  {
    id: 1, name: '突击步枪', shortName: '突击步枪', isSupplyOnly: false,
    damage: 37, headshotMult: 2.2, pellets: 1, spread: 0.045, grazeDamageMin: 30,   // 命中主体 37；擦边按几何质量线性降到 30（大多数命中 33~34）
    speed: 1500, recoil: 84, magSize: 30, maxReserve: 90,    // 30/90
    reloadTime: 1.7, fireDelay: 0.12, terrainRadius: 8,
    explosive: false, pierceOnHeadshot: false, moveSpeedMult: 1.0, fuelMult: 1.0, fovMult: 1.0, color: '#38bdf8',
    traitDesc: '稳定连发 · 均衡主力',
  },
  {
    id: 2, name: '狙击步枪', shortName: '狙', isSupplyOnly: false,
    damage: 100, headshotMult: 2.5, pellets: 1, spread: 0.003,
    speed: 4000, recoil: 390, magSize: 3, maxReserve: 15,
    reloadTime: 2.8, fireDelay: 0.95, chargeSeconds: 0.60, terrainRadius: 16,
    explosive: false, laser: true, pierceOnHeadshot: true, lifeSeconds: 999, moveSpeedMult: 0.6, fuelMult: 0.6, fovMult: 1.30, color: '#c084fc',
    edgeDamage: 99,   // 远距离命中身体依然 100 伤害；打中身体碰撞箱边缘才造成 99 伤害（留 1 血）
    traitDesc: '无限射程 · 命中即死',
  },
  {
    id: 3, name: '火箭筒', shortName: '火箭筒', isSupplyOnly: false,
    damage: 115, headshotMult: 1.5, pellets: 1, spread: 0.0,
    speed: 780, recoil: 420, magSize: 1, maxReserve: 20,   // 弹速 ×1.5（520→780）；1 发/弹匣，共 20 个弹匣；换弹 2s
    reloadTime: 2.0, fireDelay: 0, terrainRadius: 124,   // 射击间隔 = 0（节奏由 2s 换弹决定）
    explosive: true, gravityScale: 0, lifeSeconds: 999, rocket: true, pierceOnHeadshot: false, moveSpeedMult: 0.7, fuelMult: 0.7, ascendMult: 0.7, fovMult: 1.0, color: '#fb7185',
    friendlyFire: true, selfDamage: true,   // 火箭筒：爆炸友伤/自伤
    traitDesc: '直线慢速 · 碰到爆炸',
  },
  {
    id: 4, name: '高斯枪', shortName: '高斯枪', isSupplyOnly: true,
    damage: 25, headshotMult: 2.0, pellets: 1, spread: 0.0,
    speed: 3000, recoil: 0, magSize: 24, maxReserve: 48,   // 24 / 6每秒 = 连续 4 秒
    reloadTime: 3.0, fireDelay: 0, terrainRadius: 18,      // 换弹 3s（平衡性补丁：减半）
    explosive: false, laser: true, pierceAll: true, pierceOnHeadshot: true, bounces: 2, beam: true,
    friendlyFire: true, selfDamage: true,   // 高斯：全部段可打到友军/自己
    damagePerSecond: 90, ammoPerSecond: 6, moveSpeedMult: 0.95, fuelMult: 1.0, fovMult: 1.0, color: '#22d3ee',
    traitDesc: '即时光束 · 反射2次 · 全段自伤',
  },
  {
    id: 5, name: 'M249', shortName: 'M249', isSupplyOnly: true,
    damage: 37, headshotMult: 1.8, pellets: 1, spread: 0.11, grazeDamageMin: 30,   // 与突击步枪同步（37，擦边降到 30）
    speed: 1300, recoil: 66, magSize: 120, maxReserve: 240,
    reloadTime: 3.0, fireDelay: 0.06, terrainRadius: 8,   // M249 伤害=突击(37，同步擦边分级)，高射速补给枪
    explosive: false, pierceOnHeadshot: false, moveSpeedMult: 0.78, fuelMult: 0.7, fovMult: 1.30, color: '#f97316',
    traitDesc: '重型机枪 · 火力压制',
  },
  {
    id: 6, name: '引力枪', shortName: '引力枪', isSupplyOnly: true,
    damage: 24, headshotMult: 1.6, pellets: 1, spread: 0.01,   // 伤害降低（=手枪）
    speed: 1100, recoil: 240, magSize: 6, maxReserve: 18,
    reloadTime: 2.2, fireDelay: 0.9, terrainRadius: 130, lifeSeconds: 2.2,
    explosive: true, isGravityOrb: true, gravityScale: 0.02, passWalls: true, dragPerSecond: 0.7,
    friendlyFire: true, selfDamage: true,   // 引力枪：爆炸友伤/自伤
    pierceOnHeadshot: false, moveSpeedMult: 0.86, fuelMult: 0.8, fovMult: 1.0, color: '#a855f7',   // 引力场弯曲其他子弹
    falloffStart: 200, falloffEnd: 700, falloffMin: 0.12,   // 射程与霰弹类似（200→700），远端衰减更狠
    traitDesc: '穿墙引力场 · 弯折弹道',
  },
  {
    id: 7, name: '手枪', shortName: '手枪', isSupplyOnly: false,
    damage: 24, headshotMult: 2.0, pellets: 1, spread: 0.090,
    speed: 1000, recoil: 60, magSize: 12, maxReserve: 60,
    reloadTime: 0.9, fireDelay: 0.17, terrainRadius: 6,
    explosive: false, gravityScale: 0.03, pierceOnHeadshot: false,
    moveSpeedMult: 1.50, fuelMult: 2.00, ascendMult: 1.25, fovMult: 1.0, color: '#fde047',   // 移速1.5/飞行容量2.0/升空速度1.25
    traitDesc: '移速最快 · 双倍飞行',
  },
  {
    id: 8, name: '冲锋枪', shortName: '冲锋枪', isSupplyOnly: false,
    damage: 24, headshotMult: 1.8, pellets: 1, spread: 0.24,   // 伤害 = 手枪；极高射速用大散布/弹匣平衡
    speed: 1000, recoil: 48, magSize: 30, maxReserve: 150,     // 30/150
    reloadTime: 2.2, fireDelay: 0.05, terrainRadius: 8,        // 射速极高
    explosive: false, gravityScale: 0.04, pierceOnHeadshot: false,
    moveSpeedMult: 1.25, fuelMult: 1.0, fovMult: 1.0, color: '#4ade80',
    traitDesc: '极高射速 · 机动压制',
  },
]

/** 距离衰减倍率：dist ≤ start 满伤；start~end 线性降到 min；≥end 维持 min */
export function weaponFalloff(wep: WeaponDef, dist: number, exponent = 1): number {
  const start = wep.falloffStart ?? 0
  const end = wep.falloffEnd ?? 0
  const min = wep.falloffMin ?? 1
  if (end <= start) return 1
  if (dist <= start) return 1
  if (dist >= end) return min
  const t = Math.pow((dist - start) / (end - start), exponent)
  return 1 - (1 - min) * t
}

/**
 * 连续阵亡副手平衡性阶梯解锁顺序（已移除地雷，护盾只保留唯一 100HP 档）：
 * 默认手榴弹(0) → 障碍物(1) → 护盾(2) → teleport(3) → 替身人偶(4)
 */
export const SECONDARY_UNLOCK_ORDER = [
  'frag',
  'obstacle',
  'shield',
  'teleport',
  'doll',
] as const

export type SecondaryId = (typeof SECONDARY_UNLOCK_ORDER)[number]

export const SECONDARIES: Record<string, SecondaryDef> = {
  frag: {
    id: 'frag', name: '手榴弹', icon: '💣', cd: 0.8, unlockStreak: 0,
    desc: '1 充能自然回复（6s/枚）',
  },
  obstacle: {
    id: 'obstacle', name: '障碍物', icon: '🧱', cd: 10.0, unlockStreak: 1, supplyOnly: true,
    desc: '10s冷却 · 无限生成240HP掩体',
  },
  shield: {
    id: 'shield', name: '护盾', icon: '🛡️', cd: 10.0, unlockStreak: 2, supplyOnly: true,
    desc: '100HP 护盾 · 伤害不溢出 · 碰撞箱略大',
  },
  teleport: {
    id: 'teleport', name: 'Teleport', icon: '🌀', cd: 10.0, unlockStreak: 3, supplyOnly: true,
    desc: '读条后直接出现在右键位置',
  },
  doll: {
    id: 'doll', name: '替身人偶', icon: '🎎', cd: 24.0, unlockStreak: 4, supplyOnly: true,
    desc: '连死4解锁或特殊补给拾取',
  },
}

/** 判断某副手对当前玩家是否已解锁（满足连死阈值，或替身人偶持有补给箱充能） */
export function isSecondaryUnlocked(secId: string, deathStreak: number, dollCharges = 0): boolean {
  const def = SECONDARIES[secId]
  if (!def) return false
  if (secId === 'doll' && dollCharges > 0) return true
  return (deathStreak ?? 0) >= def.unlockStreak
}

/** 获取当前已解锁的全部副手 ID 列表（按平衡性从低到高排序） */
export function getUnlockedSecondaries(deathStreak: number, dollCharges = 0): string[] {
  return SECONDARY_UNLOCK_ORDER.filter(id => isSecondaryUnlocked(id, deathStreak, dollCharges))
}

/** 获取当前连死层数下已解锁的最高阶副手 ID */
export function getHighestUnlockedSecondary(deathStreak: number, dollCharges = 0): string {
  const s = Math.max(0, Math.floor(deathStreak ?? 0))
  for (let i = SECONDARY_UNLOCK_ORDER.length - 1; i >= 0; i--) {
    const id = SECONDARY_UNLOCK_ORDER[i]
    if (s >= SECONDARIES[id].unlockStreak) return id
  }
  if (dollCharges > 0) return 'doll'
  return 'frag'
}

/** 全局玩法参数（服务器可调；随 hello/config_event 同步） */
export interface GameConfig {
  maxHp: number
  headRadius: number
  shieldHp: number
  shieldDuration: number
  dollDuration: number
  obstacleDefaultHp: number
  teleportCastTime?: number
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
  grenadeFriendlyFire: boolean   // 手雷是否伤友军
  grenadeSelfDamage: boolean     // 手雷是否伤自己
  fragMaxCharges: number   // 手雷最大充能数（自然回复）
  fragRechargeSeconds: number  // 每充能回复秒数
  dollMaxCharges: number    // 替身人偶最多可囤几个（只从补给箱获得）
  falloffExponent?: number
}

export const DEFAULT_CONFIG: GameConfig = {
  maxHp: 100,
  headRadius: 13,
  shieldHp: 100,
  shieldDuration: 5.0,
  dollDuration: 10.0,
  obstacleDefaultHp: 240,
  teleportCastTime: 0.35,
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
  grenadeFriendlyFire: true,
  grenadeSelfDamage: true,
  fragMaxCharges: 1,
  fragRechargeSeconds: 6.0,
  dollMaxCharges: 2,
}

/** 统一主武器弹量文本（唯一真实来源：WEAPONS[id].magSize / maxReserve / pellets） */
export function formatWeaponAmmoText(w: WeaponDef): string {
  return w.pellets > 1
    ? `${w.magSize}/${w.maxReserve}发(${w.pellets}丸)`
    : `${w.magSize}/${w.maxReserve}发`
}

/** 统一主武器配装卡片副标题（死亡界面与大厅共用同一文本源） */
export function formatWeaponCardSubtitle(w: WeaponDef): string {
  const ammo = formatWeaponAmmoText(w)
  return w.traitDesc ? `${ammo} · ${w.traitDesc}` : ammo
}

/** 统一副武器按钮标题（死亡界面与大厅共用同一文本源） */
export function formatSecondaryButtonTitle(s: SecondaryDef, withSupplyTag = false): string {
  if (s.unlockStreak <= 0) return `${s.icon} ${s.name} [默认]`
  if (s.id === 'doll' && withSupplyTag) return `${s.icon} ${s.name} [连死${s.unlockStreak}/补给]`
  return `${s.icon} ${s.name} [连死${s.unlockStreak}]`
}

/** 统一副武器卡片说明（结合当前 GameConfig 实时数值） */
export function formatSecondaryCardSubtitle(s: SecondaryDef, cfg: GameConfig = DEFAULT_CONFIG): string {
  if (s.id === 'frag') return `${cfg.fragMaxCharges} 充能自然回复（${cfg.fragRechargeSeconds}s/枚）`
  if (s.id === 'obstacle') return `${s.cd}s冷却 · 无限生成${cfg.obstacleDefaultHp}HP掩体`
  if (s.id === 'shield') return `${cfg.shieldHp}HP 护盾 · 伤害不溢出 · 碰撞箱略大`
  if (s.id === 'teleport') return '读条后直接出现在右键位置'
  if (s.id === 'doll') return `连死${s.unlockStreak}解锁或特殊补给拾取`
  return s.desc ?? ''
}
