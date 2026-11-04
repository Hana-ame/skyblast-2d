// core/types.ts —— 领域类型（零 IO 依赖，可在服务端复用）
export interface Vec2 { x: number; y: number }

export interface PlayerState {
  id: number
  pos: Vec2
  vel: Vec2
  aim: number        // 弧度，屏幕坐标系：0=右, π/2=下, π=左
  hp: number
  ammo: number
  jetpack: boolean   // 喷射器当前开启
  alive: boolean
  kills: number
  deaths: number
}

export interface Projectile {
  id: number
  owner: number
  pos: Vec2
  vel: Vec2
  life: number       // 剩余寿命（秒）
  r: number          // 半径
}

export interface WorldSnapshot {
  tick: number
  players: PlayerState[]
  projectiles: Projectile[]
}

// 服务器权威每 tick 的解析后动作（core 不依赖 input 层，由联机层把 Intent 合并到此）
export interface WorldInput {
  move: -1 | 0 | 1
  jump: boolean
  jetpack: boolean
  aim: number
  fire: boolean
}

export function defaultWorldInput(): WorldInput {
  return { move: 0, jump: false, jetpack: false, aim: 0, fire: false }
}
