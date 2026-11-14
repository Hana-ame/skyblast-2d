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
   *  （突击步枪正中最高 33 → 擦边最低 27） */
  grazeDamageMin?: number
  /** 逐发装填：true 时每次只装 1 发，单发耗时 = reloadTime / magSize；
   *  装填完一发即可击发（霰弹枪）。false/缺省 = 一次性装满整匣。 */
  shellReload?: boolean
  /** 爆炸衰减指数（默认 1 = 线性）。越大越陡：近爆点保持高伤，稍远迅速衰减。
   *  只影响玩家伤害的半径衰减，不改爆炸范围 terrainRadius。 */
  blastFalloffExponent?: number
  /** 按下后的读条时间（秒）：不需要按住，按一下即开始读条，读满自动发射；
   *  发射方向锁定为按下那一刻的瞄准方向。 */
  chargeSeconds?: number
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
  /** 持有该武器时自动获得 +1 挡连死副武器解锁（冲锋枪） */
  extraSecondarySlot?: boolean
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
    damage: 24, headshotMult: 1.0, pellets: 8, spread: 0.24, grazeDamageMin: 20, shellReload: true,   // 伤害=手枪弹；每颗弹丸独立擦边；逐发装填
    speed: 1000, recoil: 1560, magSize: 8, maxReserve: 32,   // 后坐力 ×2
    // 射击间隔 0.42s；装填单发 1.5/8=0.1875s。二者是唯一决定节奏的两个量：
    // 弹匣内有弹时「打-打」= 0.42s，打空后「打-装填-打」= 0.42 + 0.1875 ≈ 0.61s，
    // 自然满足「打-装填-打 比 打-打 长」，无需任何额外倍率。
    reloadTime: 1.5, fireDelay: 0.38, terrainRadius: 12,
    explosive: false, pierceOnHeadshot: false, moveSpeedMult: 1.25, fuelMult: 1.25, fovMult: 1.0, color: '#fbbf24',   // 移速/飞行容量统一 1.25x
    falloffStart: 200, falloffEnd: 700, falloffMin: 0.45,   // 霰弹随距离衰减（中距仍可用）
    traitDesc: '近距高伤 · 全中致死',
  },
  {
    id: 1, name: '突击步枪', shortName: '突击步枪', isSupplyOnly: false,
    damage: 33, headshotMult: 2.2, pellets: 1, spread: 0.12, grazeDamageMin: 27,   // 命中主体正中最高 33；擦边按几何质量线性降到 27；散布 0.12（6.88°），与 M249(0.11) 接近
    speed: 1500, recoil: 84, magSize: 30, maxReserve: 90,    // 30/90
    reloadTime: 1.7, fireDelay: 0.12, terrainRadius: 8,
    explosive: false, pierceOnHeadshot: false, moveSpeedMult: 1.0, fuelMult: 1.0, fovMult: 1.0, color: '#38bdf8',
    traitDesc: '稳定连发 · 均衡主力',
  },
  {
    id: 2, name: '狙击步枪', shortName: '狙', isSupplyOnly: false,
    damage: 137, headshotMult: 2.5, pellets: 1, spread: 0.003,
    speed: 4000, recoil: 390, magSize: 10, maxReserve: 20,
    reloadTime: 2.8, fireDelay: 0.95, chargeSeconds: 0.50, terrainRadius: 16,   // 按下后读条 0.5s 自动发射
    explosive: false, laser: true, pierceOnHeadshot: true, lifeSeconds: 999, moveSpeedMult: 0.85, fuelMult: 1.0, ascendMult: 0.85, fovMult: 1.30, color: '#c084fc',
    // 狙击擦边分级：正中（穿心）= 137，越靠碰撞箱边缘越低，最低 99。
    // edgeDamage 保留=99，作为「边缘命中上限」（连续分级的最低档即 99）。
    edgeDamage: 99, grazeDamageMin: 99,
    farRange: 900, farDamage: 99,   // 超过 900px 额外衰减到 99（远距离不再必杀）
    traitDesc: '无限射程 · 命中即死',
  },
  {
    id: 3, name: '火箭筒', shortName: '火箭筒', isSupplyOnly: false,
    damage: 160, headshotMult: 1.5, pellets: 1, spread: 0.0, blastFalloffExponent: 1.8,   // 伤害 115→160；爆炸范围不变(124)，衰减更陡
    speed: 780, recoil: 420, magSize: 1, maxReserve: 20,   // 弹速 ×1.5（520→780）；1 发/弹匣，共 20 个弹匣；换弹 2s
    reloadTime: 2.0, fireDelay: 0, terrainRadius: 124,   // 射击间隔 = 0（节奏由 2s 换弹决定）
    explosive: true, gravityScale: 0, lifeSeconds: 999, rocket: true, pierceOnHeadshot: false, moveSpeedMult: 1.0, fuelMult: 1.0, ascendMult: 1.0, fovMult: 1.0, color: '#fb7185',   // 移速/飞行容量/升空速度全部 1×
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
    damagePerSecond: 135, ammoPerSecond: 6, moveSpeedMult: 0.95, fuelMult: 1.0, fovMult: 1.0, color: '#22d3ee',   // dps 90->135：原值需照射 1.12s 才杀满血，慢于突击步枪，捡特武反而更弱
    traitDesc: '即时光束 · 反射2次 · 全段自伤',
  },
  {
    id: 5, name: 'M249', shortName: 'M249', isSupplyOnly: true,
    damage: 33, headshotMult: 1.8, pellets: 1, spread: 0.15, grazeDamageMin: 27,   // spread 0.11->0.15 回归中近距压制机枪（fovMult 保持 1.30 未动）
    speed: 1300, recoil: 66, magSize: 120, maxReserve: 240,
    reloadTime: 3.0, fireDelay: 0.06, terrainRadius: 8,   // M249 伤害=突击(33，同步擦边分级)，高射速补给枪
    explosive: false, pierceOnHeadshot: false, moveSpeedMult: 0.78, fuelMult: 0.7, fovMult: 1.30, color: '#f97316',
    traitDesc: '重型机枪 · 火力压制',
  },
  {
    id: 6, name: '引力枪', shortName: '引力枪', isSupplyOnly: true,
    damage: 160, headshotMult: 1.6, pellets: 1, spread: 0.01, grazeDamageMin: 27,   // 默认伤害=火箭筒(160)
    speed: 1100, recoil: 240, magSize: 6, maxReserve: 18,
    reloadTime: 2.2, fireDelay: 0.75, terrainRadius: 130, lifeSeconds: 2.2,   // fireDelay 0.9->0.75
    explosive: true, isGravityOrb: true, gravityScale: 0.02, passWalls: true, dragPerSecond: 0.7,
    friendlyFire: true, selfDamage: true,   // 引力枪：爆炸友伤/自伤
    pierceOnHeadshot: false, moveSpeedMult: 0.86, fuelMult: 0.8, fovMult: 1.0, color: '#a855f7',   // 引力场弯曲其他子弹
    falloffStart: 200, falloffEnd: 700, falloffMin: 0.35,   // falloffMin 0.12->0.35：射程与霰弹类似(200→700)，但远端不再跌破 80 伤害
    traitDesc: '穿墙引力场 · 弯折弹道',
  },
  {
    id: 7, name: '手枪', shortName: '手枪', isSupplyOnly: false,
    damage: 24, headshotMult: 2.2, pellets: 1, spread: 0.090, grazeDamageMin: 20,   // 爆头 2.0->2.2：爆头 53 伤害，两枪爆头即可击杀 100HP（原需 3 枪，精准无跨阈值回报）
    speed: 1000, recoil: 60, magSize: 12, maxReserve: 60,
    reloadTime: 0.9, fireDelay: 0.15, terrainRadius: 6,          // 射速 0.17->0.15（DPS 141->160）
    explosive: false, gravityScale: 0.03, pierceOnHeadshot: false,
    moveSpeedMult: 1.50, fuelMult: 2.00, ascendMult: 1.25, fovMult: 1.0, color: '#fde047',   // 移速1.5/飞行容量2.0/升空速度1.25
    traitDesc: '移速最快 · 双倍飞行',
  },
  {
    id: 8, name: '冲锋枪', shortName: '冲锋枪', extraSecondarySlot: true, isSupplyOnly: false,
    damage: 24, headshotMult: 1.8, pellets: 1, spread: 0.18, grazeDamageMin: 20,   // 伤害 = 手枪；散布 0.24->0.18 提升中近距有效命中（原与霰弹同散布不合理）
    speed: 1000, recoil: 48, magSize: 30, maxReserve: 150,     // 30/150
    reloadTime: 1.5, fireDelay: 0.05, terrainRadius: 8,        // 射速极高；换弹 1.2->1.5s 拉长空窗惩罚
    explosive: false, gravityScale: 0.04, pierceOnHeadshot: false,
    moveSpeedMult: 1.25, fuelMult: 1.25, fovMult: 1.0, color: '#4ade80',   // 飞行容量 1.0 -> 1.25（与移速统一）
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
 * 连续阵亡副手平衡性阶梯解锁顺序（已移除地雷，护盾只保留唯一档）：
 * 默认手榴弹(0) → 障碍物(1) → teleport(2) → 护盾(3) → 替身人偶(4)
 * 2026-11-14：shield 与 teleport 顺序对调 —— 护盾（伤害不溢出的 100HP 等效血量翻倍）
 * 在 2 连死就解锁过强，实测对拼胜率 96.8% 甚至超过 4 连死的替身人偶；
 * 改为 3 连死解锁，2 连死先给位移型的 teleport。
 */
export const SECONDARY_UNLOCK_ORDER = [
  'frag',
  'obstacle',
  'teleport',
  'shield',
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
    id: 'shield', name: '护盾', icon: '🛡️', cd: 10.0, unlockStreak: 3, supplyOnly: true,
    desc: '70HP 护盾 · 伤害不溢出 · 碰撞箱略大',
  },
  teleport: {
    id: 'teleport', name: 'Teleport', icon: '🌀', cd: 10.0, unlockStreak: 2, supplyOnly: true,
    desc: '读条后直接出现在右键位置',
  },
  doll: {
    id: 'doll', name: '替身人偶', icon: '🎎', cd: 24.0, unlockStreak: 4, supplyOnly: true,
    desc: '连死4解锁或特殊补给拾取',
  },
}

/** 计算玩家的等效连死副手解锁档位（选用冲锋枪 weaponIndex===8 时自动获得连死 +1 挡的副武器选择权） */
export function getEffectiveUnlockStreak(deathStreak: number, weaponIndex?: number): number {
  const base = Math.max(0, Math.floor(deathStreak ?? 0))
  const bonus = weaponIndex !== undefined && WEAPONS[weaponIndex]?.extraSecondarySlot ? 1 : 0
  return base + bonus
}

/** 手榴弹充能上限 = 连死数（0 或 1 连死时为 baseMax=1，连死 N>=1 时上限为 N） */
export function getPlayerFragMaxCharges(deathStreak: number, baseMax = 1): number {
  return Math.max(baseMax, Math.floor(deathStreak ?? 0))
}

/** 判断某副手对当前玩家是否已解锁（满足连死阈值/冲锋枪+1挡，或替身人偶持有补给箱充能） */
export function isSecondaryUnlocked(secId: string, deathStreak: number, dollCharges = 0, weaponIndex?: number): boolean {
  const def = SECONDARIES[secId]
  if (!def) return false
  if (secId === 'doll' && dollCharges > 0) return true
  return getEffectiveUnlockStreak(deathStreak, weaponIndex) >= def.unlockStreak
}

/** 获取当前已解锁的全部副手 ID 列表（按平衡性从低到高排序） */
export function getUnlockedSecondaries(deathStreak: number, dollCharges = 0, weaponIndex?: number): string[] {
  return SECONDARY_UNLOCK_ORDER.filter(id => isSecondaryUnlocked(id, deathStreak, dollCharges, weaponIndex))
}

/** 获取当前连死层数下已解锁的最高阶副手 ID */
export function getHighestUnlockedSecondary(deathStreak: number, dollCharges = 0, weaponIndex?: number): string {
  const s = getEffectiveUnlockStreak(deathStreak, weaponIndex)
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
  /** 测试或自定义模式禁用中央高斯补给箱刷新 */
  disableCenterSupplyCrate?: boolean
}

export const DEFAULT_CONFIG: GameConfig = {
  maxHp: 100,
  headRadius: 13,
  shieldHp: 70,
  shieldDuration: 5.0,
  dollDuration: 10.0,
  obstacleDefaultHp: 240,
  teleportCastTime: 0.35,
  grenadeDamage: 520,   // 一发致死：最远衰减(0.2)也有 104 伤害
  grenadeRadius: 100,
  grenadeFuse: 1.25,
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
