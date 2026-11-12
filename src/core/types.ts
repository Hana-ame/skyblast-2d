// core/types.ts —— 纯数据契约（零逻辑、可 JSON 序列化 = 天然快照格式）
// 覆盖 SkyBlast 全部玩法实体：玩家/弹丸/手雷/地雷/空袭/可破坏障碍物/占领点/弹药点/补给箱/迫击炮/瞭望塔/传送门/替身人偶/事件
export interface Vec2 { x: number; y: number }

export type TeamId = 'red' | 'blue' | 'green' | 'ffa'

export interface DollSnapshot {
  pos: Vec2
  hp: number
  shieldHp: number
  fuel: number
  weaponIndex: number
  ammo: number[]
  reserveAmmo: number[]
  timer: number          // 剩余回溯秒数
}

export interface PlayerState {
  id: number
  pos: Vec2
  vel: Vec2
  aim: number            // 弧度
  team: TeamId
  name: string
  hp: number
  maxHp: number
  alive: boolean
  onGround: boolean
  deployed: boolean      // false = 待机整备（未部署/等待重生）
  /** 当前选中的复活点 id（'base' 或已占领的旗帜据点 id 如 'cp_c'；占领后可在 UI 选中或按 E 选中） */
  selectedSpawnId?: string | null
  // 武器经济（有限弹匣 + 有限备弹，v2 核心）
  weaponIndex: number
  /** 上次使用的常规主武器（补给特武是临时的；重生时回退到它）。旧协议解码可能缺失 → 视为当前武器 */
  lastPrimaryIndex?: number
  ammo: number[]         // 每把武器当前弹匣
  reserveAmmo: number[]  // 每把武器备弹
  reloading: boolean
  reloadTimer: number    // 秒
  fireCooldown: number   // 秒
  chargeTimer: number    // 蓄力已持续秒数（狙击等蓄力武器；松手清零，满 chargeSeconds 发射）
  /** 蓄力锁定方向（rad）：蓄力开始时记录，蓄力期间不再跟随瞄准输入 → 蓄力中不能改发射方向 */
  chargeAim?: number
  /** 上一帧的开火键状态：用于检测「按下沿」（狙：按一下开始读条，不需按住） */
  prevFireHeld?: boolean
  // 副武器（连死按平衡性阶梯解锁：frag → obstacle → shield → teleport → mine → doll）
  secondary: string      // 'frag'|'obstacle'|'shield'|'teleport'|'mine'|'doll'
  secondaryCooldown: number
  fragCharges: number        // 手雷当前可用充能（上限 fragMaxCharges，自然回复）
  fragRechargeTimer: number  // 当前充能已累计回复秒数
  // 喷气背包（燃料槽）
  jetpack: boolean
  fuel: number           // 0..jetpackFuel（秒）
  // 能量护盾
  shieldHp: number
  shieldTimer: number
  // 瞭望塔视野加成 / 传送门冷却
  watchtowerTimer: number
  /** 当前登上的瞭望塔 id（非 null 时玩家位置锁定在塔顶、不能移动，享 200% 视野；再按 E 下塔） */
  mountedTowerId: string | null
  warpCooldown: number
  // Teleport 读条传送状态（读条结束后直接出现在右键目标位置）
  teleportTimer?: number
  teleportTarget?: Vec2 | null
  // 替身人偶锚点（激活期间非 null）+ 可用充能数（特殊补给箱获得，或连死解锁赠送）
  doll: DollSnapshot | null
  dollCharges: number
  // 重生倒计时（>0 表示死亡等待重生）
  respawnTimer: number
  /** 独立后坐力速度通道：与 vel 分离（不受移动覆写/重力/速度上限影响），指数阻尼衰减。
   *  这样上下左右斜向、静止/移动/下落/喷气时的击退位移完全一致。 */
  recoilVel?: Vec2
  kills: number
  deaths: number
  /** 当前生命内的击杀数（若本命已有击杀，阵亡时连死计数保持 0 而非变成 1） */
  lifeKills?: number
  /** 连续死亡次数（每次零击杀阵亡 +1，获得击杀或有击杀阵亡时重置为 0；用于按平衡性阶梯依次解锁副手） */
  deathStreak: number
}

export interface Projectile {
  id: number
  owner: number
  pos: Vec2
  vel: Vec2
  /** 发射点（用于按飞行距离计算伤害衰减；网络反序列化弹丸可能缺失，回退到当前位置） */
  spawnX?: number
  spawnY?: number
  /** 武器槽位索引（用于查衰减曲线；迫击炮等非武器置 -1） */
  weaponId: number
  /** 弹道弯曲角速度 rad/s（0 = 不弯曲；引力枪 >0） */
  curveRate: number
  life: number
  r: number
  damage: number
  headshotMult: number
  explosive: boolean
  terrainRadius: number
  gravityScale: number
  pierceOnHeadshot: boolean
  pierceAll: boolean
  isGravityOrb: boolean
  weaponLabel: string
  color: string
  hitTargets: number[]     // 穿透弹已命中目标（防同目标重复结算）
  bounces: number          // 剩余撞墙反弹次数（高斯枪 2 次）
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
  fuse: number            // 秒
  bounces: number
}

export interface Landmine {
  id: number
  owner: number           // -1 = 关卡预设地雷
  pos: Vec2
  vel: Vec2
  armed: boolean
  armTimer: number        // 秒
  triggered: boolean
  fuse: number            // 秒
  instant: boolean        // 瞬爆雷（触发即炸）
  directHit: boolean      // 落点直接踩中玩家 → 瞬爆
  preset: boolean
  presetIndex?: number
  respawnTimer: number    // >0 表示预设雷已炸、等待重生
}

export interface Airstrike {
  id: number
  owner: number
  pos: Vec2
  timer: number           // 秒（倒计时结束投放 3 枚航弹）
  WarningRadius?: number
  /** 是否已完成投放（消费端/二进制协议仍在用；new 核心以 timer 判定） */
  dropped?: boolean
}

export interface Obstacle {
  id: string
  x: number
  y: number
  w: number
  h: number
  hp: number
  maxHp: number
  kind?: 'wall' | 'box' | 'sandbag'
  color: string
  borderColor: string
  label: string
}

export interface CapturePoint {
  id: string
  code: string            // 'A'..'E'
  name: string
  x: number
  y: number
  radius?: number
  ownerTeam: TeamId | null
  capturingTeam: TeamId | null
  progress: number        // 0..100
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
  respawnTimer: number    // 秒
}

export interface Mortar {
  id: string
  name: string
  x: number
  y: number
  angle: number           // 弧度
  power: number
  operatorId: number | null
  cooldown: number        // 秒
}

export interface Watchtower {
  id: string
  name: string
  x: number
  y: number
  operatorId: number | null
}

export interface WarpPortal {
  id: string
  name: string
  x: number
  y: number
  targetId: string
  color: string
}

// 模拟层只认这个归一化输入（由 InputMapper 从 Intent[] 翻译而来）
export interface SecondaryIntent {
  type: string
  targetX: number
  targetY: number
}

export interface WorldInput {
  move: -1 | 0 | 1
  jump: boolean
  jetpack: boolean
  dive: boolean          // 按下键
  aim: number
  fire: boolean
  reload: boolean
  switchWeapon: number | null
  interact: boolean
  secondary: SecondaryIntent | null
}

// 触发事件（瞬态、不进快照；由 World 产出、net/ui 层订阅 → killfeed/音效/粒子）
export interface WorldEvent {
  /** 高斯枪光束分段（kind='laser' 时） */
  segments?: { x1: number; y1: number; x2: number; y2: number; dx?: number; dy?: number }[]
  duration?: number
  color?: string
  kind:
    | 'explosion' | 'hit' | 'kill' | 'capture' | 'supply_pickup' | 'ammo_pickup'
    | 'warp' | 'watchtower' | 'shield' | 'doll_recall' | 'airstrike' | 'mortar_fire' | 'laser'
    | 'projectile_spawn' | 'projectile_bounce' | 'projectile_destroy'
    // 旧版 kind（表现层/协议仍在处理）
    | 'headshot' | 'pierce' | 'obstacle_destroy' | 'shield_break' | 'airstrike_drop'
  x?: number
  y?: number
  radius?: number
  // 新版字段
  attackerId?: number
  victimId?: number
  headshot?: boolean
  playerId?: number
  /** 事件主体玩家名（拾取/命中广播用，客机无需反查也能显示） */
  playerName?: string
  weaponLabel?: string
  weaponName?: string
  pointCode?: string
  team?: TeamId
  damage?: number
  projectile?: Projectile
  projectileId?: number
  // 旧版字段（表现层/协议仍读）
  killerId?: number
  killerName?: string
  victimName?: string
  killerTeam?: TeamId
  victimTeam?: TeamId
  isHeadshot?: boolean
  isPierced?: boolean
  obstacleId?: string
  weaponId?: number
  vx?: number
  vy?: number
  bounces?: number
  /** 弹丸剩余寿命（projectile_bounce 事件同步用） */
  life?: number
  spawnX?: number
  spawnY?: number
}

export function defaultWorldInput(): WorldInput {
  return {
    move: 0, jump: false, jetpack: false, dive: false, aim: 0,
    fire: false, reload: false, switchWeapon: null, interact: false, secondary: null,
  }
}
