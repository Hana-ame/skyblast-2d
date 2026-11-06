// web/app/context.ts —— 浏览器端共享上下文（画布/相机/权威世界/输入状态/表现层数据）
// 工程化拆分的单一状态源：所有 app/* 模块只从这里读状态、通过其可变容器写状态。
import { World, JUMP_PADS } from '../../core/sim/world.ts'
import { Effects } from '../effects.ts'
import { WORLD_W, WORLD_H } from '../../core/wrap.ts'
import type { PlayerState, TeamId } from '../../core/types.ts'

// ── 画布与相机 ──
export const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
export const ctx = canvas ? canvas.getContext('2d')! : null
export const camera = { x: 6600, y: 2380, fovFactor: 1.0 }
export const screenFx = { shake: 0 }

export function resizeCanvas(): void {
  if (!canvas) return
  canvas.width = window.innerWidth || 1024
  canvas.height = window.innerHeight || 640
}

// ── 世界（服务器权威；本页 = 主机） ──
export const world = new World(20261106)
export const localPlayer = world.addPlayer('SkyHunter', 'red')
localPlayer.deployed = false   // 待机整备中（大厅点「立即进入战场」部署）
world.config.randomSpawn = true

// AI 机器人（经权威输入驱动）
export const botNames = ['AlphaBot-7', 'Valkyrie-AI', 'Titan-09', 'NovaStriker', 'ZeroGrav-X', 'OmegaHound', 'Phantom-AI', 'IronClad-8']
export const botTeams: TeamId[] = ['blue', 'green', 'red', 'blue', 'green', 'blue', 'red', 'green']
export const botSecs = ['frag', 'doll', 'frag', 'frag', 'doll', 'frag', 'frag', 'frag']
export const bots: PlayerState[] = []

// ── 待部署配装 / 对战模式 ──
export const pendingLoadout = { weaponIndex: 0, secondaryType: 'frag', spawnPointId: 'base' }
export const mode = { current: 'ffa' as 'ffa' | '2teams' }

// ── 输入状态 ──
export const keys: Record<string, boolean> = {}
export const mouse = { x: 0, y: 0, worldX: 6600, worldY: 2380, down: false }
export const touchState = {
  enabled: false,
  moveActive: false, moveId: -1, moveX: 0, moveY: 0,
  boostButtonDown: false,
  aimActive: false, aimId: -1, aimX: 0, aimY: 0,
}
export const inputQueue: {
  interact: boolean
  secondary: { type: string; targetX: number; targetY: number } | null
  reload: boolean
} = { interact: false, secondary: null, reload: false }

// ── 客户端特效（纯表现层） ──
export const effects = new Effects()
export const beams: { segments: { x1: number; y1: number; x2: number; y2: number }[]; color: string; life: number; maxLife: number }[] = []

// ── 世界锚定背景 ──
const starRng = (() => {
  let seed = 0x9e3779b9
  return (): number => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
})()
export const worldStars = (() => {
  const out: { x: number; y: number; r: number; a: number }[] = []
  for (let i = 0; i < 640; i++) {
    out.push({ x: starRng() * WORLD_W, y: starRng() * WORLD_H, r: 0.6 + starRng() * 1.4, a: 0.2 + starRng() * 0.6 })
  }
  return out
})()
export const worldGlows = [
  { x: 6600, y: 1080, r: 620, c: '56,189,248', a: 0.09 },
  { x: 4150, y: 3560, r: 520, c: '16,185,129', a: 0.07 },
  { x: 10150, y: 3520, r: 520, c: '244,63,94', a: 0.07 },
]
export const FIXED = 1 / 60
export { JUMP_PADS }
