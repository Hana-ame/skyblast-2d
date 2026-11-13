// web/app/context.ts —— 浏览器端共享上下文（画布/相机/权威世界/输入状态/特性Flag开关/表现层数据）
// 工程化拆分的单一状态源：所有 app/* 模块只从这里读状态、通过其可变容器写状态。
import { World, JUMP_PADS } from '../../core/sim/world.ts'
import { sanitizeMapData, defaultMapData } from '../../core/map.ts'
import { BALANCE_KEY, sanitizeOverrides, applyWeaponOverrides, applyConfigOverrides } from '../../core/balanceOverrides.ts'
import { setPhysicsParams, getPhysicsParams } from '../../core/sim/physics.ts'
import type { MapData } from '../../core/map.ts'
import { Effects } from '../effects.ts'
import { WORLD_W, WORLD_H } from '../../core/wrap.ts'
import type { PlayerState, TeamId } from '../../core/types.ts'

// ── 特性开关（Feature Flags，全部默认开启 true，支持 HUD / 大厅 / 调试器实时切换） ──
export interface FeatureFlags {
  /** 右上角全景战术雷达小地图（10据点颜色与争夺脉冲、队友/敌方、特武箱、视野框，支持点击据点选复活点） */
  minimapRadar: boolean
  /** 沉浸式占点双向读条 HUD 面板与旗杆底座弧形进度环（显示 100→0 中和阶段 / 0→100 占领阶段与协同加速倍率） */
  captureHudRing: boolean
  /** 联机动态快照降频（20~30Hz）+ AOI 视野兴趣区裁剪 + 弹丸事件化增量省流 */
  adaptiveNetAoi: boolean
  /** 服务端开火延迟补偿（Lag Compensation，按客机 RTT 回溯目标历史位置判定命中） */
  lagCompensation: boolean
  /** AI 战术协同占点与智能回防（优先增援掉进度的本队旗帜、守点自动开盾/立掩体） */
  smartBotTactics: boolean
  /** WebAudio 零依赖过程式合成音效（射击、爆头、击杀、破盾、爆炸，不含占点音效） */
  proceduralAudio: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  minimapRadar: true,
  captureHudRing: true,
  adaptiveNetAoi: true,
  lagCompensation: true,
  smartBotTactics: true,
  proceduralAudio: true,
}

export const FEATURE_FLAG_META: { key: keyof FeatureFlags; icon: string; label: string; desc: string }[] = [
  { key: 'minimapRadar',    icon: '📡', label: '战术雷达小地图', desc: '右上角全景雷达，显示10据点态势、队友/特武箱并支持点击选复活点' },
  { key: 'captureHudRing',  icon: '🚩', label: '占点双向读条HUD', desc: '站上据点时显示 100→0 中和 / 0→100 占领双阶段进度面板与地面进度环' },
  { key: 'adaptiveNetAoi',  icon: '⚡', label: '动态降频与AOI省流', desc: '联机按人数动态调节快照频率并启用视野裁剪与弹丸事件化同步' },
  { key: 'lagCompensation', icon: '🎯', label: '服务端延迟补偿', desc: '服务端维护500ms历史轨迹，按客机RTT回溯命中判定消除高延迟提前量' },
  { key: 'smartBotTactics', icon: '🤖', label: 'AI协同守点智能', desc: 'AI优先回防掉进度的本队旗帜并在守点交火时自动开启护盾/掩体' },
  { key: 'proceduralAudio', icon: '🔊', label: 'WebAudio战术音效', desc: '零外部音频依赖，过程式合成射击、爆头、击杀、护盾破碎与爆炸音效' },
]

export const featureFlags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS }

export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, val: boolean): void {
  featureFlags[key] = Boolean(val)
  if (key === 'lagCompensation') {
    world.lagCompensationEnabled = featureFlags.lagCompensation
  }
}

export function toggleFeatureFlag<K extends keyof FeatureFlags>(key: K): boolean {
  const next = !featureFlags[key]
  setFeatureFlag(key, next)
  return next
}

export function resetAllFeatureFlags(): void {
  for (const k of Object.keys(DEFAULT_FEATURE_FLAGS) as (keyof FeatureFlags)[]) {
    setFeatureFlag(k, DEFAULT_FEATURE_FLAGS[k])
  }
}

// ── 画布与相机 ──
export const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
export const ctx = canvas ? canvas.getContext('2d')! : null
export const camera = { x: 6600, y: 1500, fovFactor: 1.0 }
export const screenFx = { shake: 0 }

/** 画布后备缓冲尺寸只在真正需要时改写：每次赋值都会重建后备缓冲与 GPU 纹理，
 *  成本随面积线性增长。尺寸来源优先级：visualViewport（不受移动端地址栏收放影响）
 *  > innerWidth/innerHeight > 布局尺寸。抖动 <2px 的变化直接忽略，避免地址栏
 *  收放导致的周期性全量重建（曾造成"隔一段时间卡一下"）。 */
const resizeDebounceMs = 120
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let pendingResize = false

function computeCanvasSize(): { w: number; h: number } {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  const rect = canvas && typeof canvas.getBoundingClientRect === 'function'
    ? canvas.getBoundingClientRect()
    : { width: 0, height: 0 }
  const iw = window.innerWidth || document.documentElement?.clientWidth || rect.width || 1024
  const ih = window.innerHeight || document.documentElement?.clientHeight || rect.height || 640
  // visualViewport 在移动端能规避地址栏收放的 innerHeight 抖动；但它有时只反映布局视口，
  // 因此取 Math.min 兜底：既不会被放大，也能跟随真实缩小。
  const rawW = vv?.width ? Math.min(iw, vv.width) : iw
  const rawH = vv?.height ? Math.min(ih, vv.height) : ih
  return { w: Math.max(320, Math.round(rawW)), h: Math.max(240, Math.round(rawH)) }
}

export function resizeCanvas(): void {
  if (!canvas) return
  const { w, h } = computeCanvasSize()
  // 亚像素/地址栏级别的轻微抖动一律不改写画布
  if (Math.abs(canvas.width - w) < 2 && Math.abs(canvas.height - h) < 2) return
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
}

/** 去抖版本：resize/ResizeObserver 连续触发时合并为一次真正的画布重建 */
export function requestResizeCanvas(): void {
  pendingResize = true
  if (resizeTimer !== null) return
  resizeTimer = setTimeout(() => {
    resizeTimer = null
    if (!pendingResize) return
    pendingResize = false
    resizeCanvas()
  }, resizeDebounceMs)
}

// ── 世界（服务器权威；本页 = 主机） ──
function loadCustomMap(): MapData | undefined {
  try {
    const raw = localStorage.getItem('pvp-custom-map')
    if (!raw) return undefined
    const m = sanitizeMapData(JSON.parse(raw))
    if (!m || m.name !== defaultMapData().name) return undefined
    return m
  } catch { return undefined }
}
export const customMap = loadCustomMap()

function loadBalanceOverrides() {
  try {
    const raw = localStorage.getItem(BALANCE_KEY)
    if (!raw) return null
    return sanitizeOverrides(JSON.parse(raw))
  } catch { return null }
}
export const balanceOverrides = loadBalanceOverrides()
applyWeaponOverrides(balanceOverrides?.weapons)
if (balanceOverrides?.physics) setPhysicsParams({ ...getPhysicsParams(), ...balanceOverrides.physics })

export const world = new World(20261106, customMap)
world.lagCompensationEnabled = featureFlags.lagCompensation
applyConfigOverrides(world.config, balanceOverrides?.config)
export const localPlayer = world.addPlayer('SkyHunter', 'red')
localPlayer.deployed = false
world.config.randomSpawn = false

// AI 机器人（经权威输入驱动；无绿队）
export const botNames = ['AlphaBot-7', 'Valkyrie-AI', 'Titan-09', 'NovaStriker', 'ZeroGrav-X', 'OmegaHound', 'Phantom-AI', 'IronClad-8']
export const botTeams: TeamId[] = ['blue', 'red', 'blue', 'red', 'blue', 'red', 'blue', 'red']
export const botSecs = ['frag', 'doll', 'frag', 'frag', 'doll', 'frag', 'frag', 'frag']
export const bots: PlayerState[] = []

// ── 待部署配装 / 对战模式 / 房主规则与 UI 状态 ──
export const pendingLoadout = { weaponIndex: 0, secondaryType: 'frag', spawnPointId: 'base' }
export const mode = {
  current: '2teams' as 'ffa' | '2teams',
  /** 双队模式下是否允许玩家以 FFA 独狼身份加入（由房主配置） */
  allowFfaInTeams: true,
}
export const uiState = {
  lobbyRole: 'host' as 'host' | 'client',
  debugHudOpen: false,
  flagsHudOpen: false,
  sysBarOpen: false,
}

// ── 输入状态 ──
export const keys: Record<string, boolean> = {}
export const mouse = { x: 0, y: 0, worldX: 6600, worldY: 1500, down: false }
export const touchState = {
  enabled: false,
  moveActive: false, moveId: -1, moveX: 0, moveY: 0,
  boostButtonDown: false,
  aimActive: false, aimId: -1, aimX: 0, aimY: 0,
  lastAimAngle: 0,
  wasGroundedBeforeAscend: false,
  aimUsed: false,
}
export const inputQueue: {
  interact: boolean
  secondary: { type: string; targetX: number; targetY: number } | null
  reload: boolean
} = { interact: false, secondary: null, reload: false }

// ── 客户端特效（纯表现层） ──
export const effects = new Effects()
export const beams: { playerId?: number; segments: { x1: number; y1: number; x2: number; y2: number; dx?: number; dy?: number }[]; color: string; life: number; maxLife: number }[] = []

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
  { x: 6600, y: 720, r: 620, c: '56,189,248', a: 0.11 },
  { x: 260, y: 1700, r: 520, c: '244,63,94', a: 0.09 },
  { x: 12940, y: 1700, r: 520, c: '14,165,233', a: 0.09 },
]
export const FIXED = 1 / 60
export { JUMP_PADS }
