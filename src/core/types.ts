// core/types.ts —— 领域类型（零 IO 依赖，可在服务端复用）
// 合并扩展：v2 玩法实体（障碍物/手雷/地雷/空袭/占点/弹药包/补给箱/替身人偶）全部进领域类型
import type { WorldSnapshot } from './snap.ts'

export interface Vec2 { x: number; y: number }

export type TeamId = 'red' | 'blue' | 'green' | 'ffa'

export interface PlayerState {
  id: number
  pos: Vec2
  vel: Vec2
  aim: number        // 弧度，屏幕坐标系：0=右, π/2=下, π=左
  team: TeamId
  name: string
  hp: number
  maxHp: number
  alive: boolean
  deployed: boolean      // false = 待机整备（未部署/等待重生）
  // 武器经济（有限弹匣 + 有限备弹，v2 核心）
  weaponIndex: number
  /** 上次使用的常规主武器（补给特武是临时的；重生时回退到它，避免复活后还卡着超级武器） */
  lastPrimaryIndex: number
  ammo: number[]         // 每把武器当前弹匣
  reserveAmmo: number[]  // 每把武器备弹
  reloading: boolean
  reloadTimer: number
  fireCooldown: number
  chargeTimer: number      // 开火蓄力计时（chargeSeconds 武器）
  // 副武器
  secondary: string      // SECONDARIES key（frag / doll）
  secondaryCooldown: number
  fragCharges: number    // 手雷充能数（上限 fragMaxCharges）
  fragRechargeTimer: number
  // 喷射器
  jetpack: boolean
  fuel: number
  onGround: boolean
  // 战术状态
  shieldHp: number
  shieldTimer: number
  watchtowerTimer: number      // 旧 20s 加成（已废弃，保留下兼容）
  mountedTowerId: string | null  // 正在操控的瞭望塔（上塔锁定，视野 200%，下塔即失效）
  warpCooldown: number
  doll: DollSnapshot | null   // 替身人偶锚（10s 生死回溯）
  dollCharges: number         // 替身人偶持有数（只从特殊补给箱获得）
  respawnTimer: number
  kills: number
  deaths: number
}

/** 替身人偶快照：使用瞬间的位置与状态（v2 dollState；多端一致性靠服务器权威） */
export interface DollSnapshot {
  pos: Vec2
  hp: number
  shieldHp: number
  fuel: number
  weaponIndex: number
  ammo: number[]
  reserveAmmo: number[]
  timer: number
}

export interface Projectile {
  id: number
  owner: number
  pos: Vec2
  vel: Vec2
  life: number       // 剩余寿命（秒）
  r: number          // 半径
  // v2 弹道属性
  damage: number
  headshotMult: number
  explosive: boolean
  terrainRadius: number    // 爆炸半径
  gravityScale: number
  pierceOnHeadshot: boolean
  pierceAll: boolean
  isGravityOrb: boolean
  weaponId: number          // 发射武器 id（狙击远距衰减用）
  curveRate: number         // 弹道弯曲速率 rad/s（引力枪）
  weaponLabel: string
  color: string
  hitTargets: number[]     // 穿透弹已命中目标（防同目标重复结算）
  bounces: number          // 剩余撞墙反弹次数（高斯枪 3 次）
  passWalls: boolean       // 穿透原始地形（引力弹）
  beam: boolean            // 光束渲染（高斯枪）
  rocket: boolean          // 火箭弹渲染（直线爆炸弹）
  dragPerSecond: number    // 每秒速度保留比例（1=不减速；引力弹 <1）
}

export interface Grenade {
  id: number
  owner: number
  pos: Vec2
  vel: Vec2
  fuse: number
  bounces: number
}

export interface Landmine {
  id: number
  owner: number         // 0 = 公共预设雷
  pos: Vec2
  vel: Vec2
  armed: boolean
  armTimer: number
  triggered: boolean
  fuse: number
  instant: boolean      // 瞬发地雷
  directHit: boolean    // 副武器投掷雷支持直击触发
  preset: boolean       // 地图预设（爆炸后定时重生）
  respawnTimer: number
}

export interface Airstrike {
  id: number
  owner: number
  pos: Vec2
  timer: number
  dropped: boolean
}

/** 可破坏障碍物（预设 + 玩家 barricade 副武器生成） */
export interface Obstacle {
  id: string
  x: number
  y: number
  w: number
  h: number
  hp: number
  maxHp: number
  label: string
  color: string
  borderColor: string
}

export interface CapturePoint {
  id: string
  code: string
  name: string
  x: number
  y: number
  ownerTeam: TeamId | null
  progress: number
  capturingTeam: TeamId | null
}

export interface WarpPortal {
  id: string
  name: string
  x: number
  y: number
  targetId: string
  color: string
}

export interface AmmoPack {
  id: number
  x: number
  y: number
  area: string
}

export interface SupplyCrate {
  id: number
  x: number
  y: number
  area: string
  kind: 'weapon' | 'doll'   // weapon=空投特武（高斯枪/M249/引力枪）；doll=替身人偶（特殊补给）
  weaponId: number
  weaponName: string
  color: string
  active: boolean
  respawnTimer: number
}

export interface Watchtower { id: string; name: string; x: number; y: number; operatorId: number | null }
export interface Mortar { id: string; name: string; x: number; y: number; angle: number; power: number; cooldown: number; operatorId: number | null }
export interface JumpPad { x: number; y: number; vx: number; vy: number }
export interface WarpUse { x: number; y: number }   // 传送门特效事件（瞬态）

export type WorldSnapshotT = WorldSnapshot

// 服务器权威每 tick 的解析后动作（core 不依赖 input 层，由联机层把 Intent 合并到此）
export interface WorldInput {
  move: -1 | 0 | 1
  jump: boolean
  jetpack: boolean
  dive: boolean        // 下降加速（按住下键）
  aim: number
  fire: boolean
  reload: boolean
  // v2 新增意图
  secondary: SecondaryIntent | null   // 触发一次即消费（瞬时意图）
  interact: boolean                   // E 键：瞭望塔/传送门/迫击炮/补给站（瞬时意图）
  switchWeapon: number | null         // 换主武器（-1 = 无操作）
}

/** 副武器使用意图：null = 不用；带准星世界坐标（空袭/工事用） */
export interface SecondaryIntent {
  type: string          // SECONDARIES key
  targetX: number
  targetY: number
}

export function defaultWorldInput(): WorldInput {
  return { move: 0, jump: false, jetpack: false, dive: false, aim: 0, fire: false, reload: false, secondary: null, interact: false, switchWeapon: null }
}

// 触发事件（瞬态、不进快照；由 World 产出、net/ui 层订阅 → killfeed/音效/粒子）
export interface WorldEvent {
  /** 高斯枪光束分段（kind='laser' 时） */
  segments?: { x1: number; y1: number; x2: number; y2: number }[]
  duration?: number
  color?: string
  kind: 'kill' | 'headshot' | 'pierce' | 'explosion' | 'obstacle_destroy' | 'capture' | 'supply_pickup' | 'ammo_pickup' | 'warp' | 'shield_break' | 'doll_recall' | 'mortar_fire' | 'airstrike_drop' | 'laser'
  x?: number
  y?: number
  radius?: number
  killerId?: number
  victimId?: number
  killerName?: string
  victimName?: string
  killerTeam?: TeamId
  victimTeam?: TeamId
  weaponLabel?: string
  isHeadshot?: boolean
  isPierced?: boolean
  obstacleId?: string
  pointCode?: string
  team?: TeamId
  playerId?: number
  weaponName?: string
}
