// web/app/diag.ts —— 运行时性能诊断记录器（帧间隔/掉帧现场/长任务/LoAF → 可导出日志）
//
// 目标：真机出现"隔一段时间卡一下"时，不必开着 DevTools 猜，而是让页面自己把
// 现场记录下来，复现一次后一键导出 log（.json 全量 + .txt 摘要）回报。
//
// 设计约束：
//  - 默认常开，但每帧只做常数级写入（预分配环形缓冲、复用对象，不产生每帧垃圾）；
//  - 只有真正掉帧/长任务时才写详细现场（低频，允许分配）；
//  - 不依赖 DOM；在 Node 测试环境下 import 不触碰浏览器 API（全部 typeof 守卫）。

export interface FrameRec {
  /** 递增帧号 */
  i: number
  /** 该帧 rAF 时间戳（performance.now 基准） */
  t: number
  /** 距上一帧的间隔 ms —— 掉帧的直接指标 */
  dt: number
  /** 本帧推进的固定步数 */
  steps: number
  /** 分段耗时 ms */
  stepMs: number
  renderMs: number
  hudMs: number
  /** 帧内总耗时（我们自己代码的 CPU 部分） */
  busyMs: number
  tick: number
  players: number
  projectiles: number
  role: string
  peers: number
  /** 局内状态 */
  hp: number
  alive: number
  deployed: number
  wep: number
  /** 相机（用于判断是否发生传送/视野突变） */
  camX: number
  camY: number
  /** 玩家「渲染用」位置（插值后）。与物理位置对比即可判断插值是否真正生效：
   *  插值正常时应逐帧连续变化，而不是只在 tick 时跳变。 */
  renX: number
  renY: number
  /** 玩家物理位置（tick 后真实值） */
  phyX: number
  phyY: number
  /** 布局/合成相关：这些一变化就可能触发全屏重绘 */
  canvasW: number
  canvasH: number
  dpr: number
  /** 全屏遮罩可见性（0/1）—— backdrop-filter/大遮罩类卡顿的关键线索 */
  ovDeath: number
  ovLobby: number
  ovParams: number
  ovEditor: number
  /** 标签页可见性 */
  hidden: number
  /** 堆用量 MB（Chrome 专有，其它浏览器为 -1） */
  heapMB: number
  /** 本帧距上一帧跨越的 rAF 次数估计（1=正常，2=掉了一帧）；用 dt/期望帧时估算 */
  missedFrames: number
}

/** 真机专属环境探测：显示器刷新率、GPU 加速状态、实际合成器帧率 */
export interface DiagEnvProbe {
  /** 用 rAF 采样估算的显示器刷新率（Hz），0 表示未测出 */
  refreshHz: number
  /** 估算 FPS */
  measuredFps: number
  /** WebGL 渲染器字符串（判断是否 SwiftShader/软件渲染） */
  webglRenderer: string
  /** Canvas 2D 是否走 GPU 加速（Chrome 专有判定） */
  canvasAccel: string
  /** navigator.hardwareConcurrency / deviceMemory */
  cores: number
  deviceMemory: number
  /** 是否处于省电模式（Chrome 专有） */
  batterySaver: boolean
  /** 页面可见性 */
  visibility: string
  /** 设备像素比与视口 */
  dpr: number
  viewport: string
}

export interface StutterRec {
  /** 帧号，可与 frames 交叉定位 */
  i: number
  t: number
  dt: number
  kind: 'frame-gap' | 'long-task' | 'loaf' | 'manual'
  /** 现场快照（key: value，便于阅读） */
  detail: Record<string, unknown>
}

export interface DiagMark {
  t: number
  i: number
  kind: string
  detail?: Record<string, unknown>
}

const RING = 1800 // 约 30s @60fps
const MAX_STUTTERS = 400
const MAX_MARKS = 200
const FRAME_GAP_MS = 24 // 超过 ~1.5 帧即视为明显掉帧（60Hz）
const SEVERE_GAP_MS = 50

const frames: FrameRec[] = []
let frameCursor = 0
let frameCount = 0
let currentIndex = 0

const stutters: StutterRec[] = []
const marks: DiagMark[] = []

let enabled = true
let installed = false
let lastFrameTs = 0
let lastFrameHidden = 0
let observers: { disconnect: () => void }[] = []

// 统计聚合（不依赖环形缓冲，长时间运行也不失真）
export const diagStats = {
  frames: 0,
  gapsOver24: 0,
  gapsOver50: 0,
  gapsOver100: 0,
  /** 后台节流导致的 gap（非真卡顿） */
  throttledGaps: 0,
  worstGapMs: 0,
  worstGapAt: 0,
  worstGapIndex: 0,
  totalBusyMs: 0,
  maxBusyMs: 0,
}

function heapMB(): number {
  try {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    return m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : -1
  } catch {
    return -1
  }
}

function overlayVisible(id: string): number {
  try {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null
    if (!el) return 0
    const cs = getComputedStyle(el)
    return cs.display !== 'none' && cs.visibility !== 'hidden' ? 1 : 0
  } catch {
    return 0
  }
}

/** 复用槽位：环形缓冲里已有旧记录就地覆盖，避免每帧分配 */
function slot(index: number): FrameRec {
  let r = frames[index]
  if (!r) {
    r = {
      i: 0, t: 0, dt: 0, steps: 0, stepMs: 0, renderMs: 0, hudMs: 0, busyMs: 0,
      tick: 0, players: 0, projectiles: 0, role: 'offline', peers: 0,
      hp: 0, alive: 0, deployed: 0, wep: 0, camX: 0, camY: 0, renX: 0, renY: 0, phyX: 0, phyY: 0,
      canvasW: 0, canvasH: 0, dpr: 0,
      ovDeath: 0, ovLobby: 0, ovParams: 0, ovEditor: 0,
      hidden: 0, heapMB: -1, missedFrames: 0,
    }
    frames[index] = r
  }
  return r
}

export interface FrameCtx {
  world: {
    tick: number
    players: { length: number }
    projectiles: { length: number }
  }
  localPlayer: { hp: number; alive: boolean; deployed: boolean; weaponIndex: number; pos: { x: number; y: number } }
  camera: { x: number; y: number }
  netState: { role: string; peerCount: number }
  canvas: { width: number; height: number } | null
  /** 玩家渲染位置（可选）：用于验证渲染插值是否真的生效 */
  renderPos?: { x: number; y: number }
}

/** 记录一帧。返回帧号，配合 diagMark 定位。 */
export function diagRecordFrame(
  now: number,
  parts: { steps: number; stepMs: number; renderMs: number; hudMs: number },
  ctx: FrameCtx,
): number {
  currentIndex++
  if (!enabled) return currentIndex

  const dt = lastFrameTs ? now - lastFrameTs : 0
  lastFrameTs = now
  const busyMs = parts.stepMs + parts.renderMs + parts.hudMs

  const idx = frameCursor
  const r = slot(idx)
  frameCursor = (frameCursor + 1) % RING
  if (frameCount < RING) frameCount++

  r.i = currentIndex
  r.t = Math.round(now * 100) / 100
  r.dt = Math.round(dt * 100) / 100
  r.steps = parts.steps
  r.stepMs = Math.round(parts.stepMs * 1000) / 1000
  r.renderMs = Math.round(parts.renderMs * 1000) / 1000
  r.hudMs = Math.round(parts.hudMs * 1000) / 1000
  r.busyMs = Math.round(busyMs * 1000) / 1000
  r.tick = ctx.world.tick
  r.players = ctx.world.players.length
  r.projectiles = ctx.world.projectiles.length
  r.role = ctx.netState.role
  r.peers = ctx.netState.peerCount
  r.hp = Math.round(ctx.localPlayer.hp)
  r.alive = ctx.localPlayer.alive ? 1 : 0
  r.deployed = ctx.localPlayer.deployed ? 1 : 0
  r.wep = ctx.localPlayer.weaponIndex
  r.camX = Math.round(ctx.camera.x)
  r.camY = Math.round(ctx.camera.y)
  r.renX = ctx.renderPos ? Math.round(ctx.renderPos.x * 100) / 100 : -1
  r.renY = ctx.renderPos ? Math.round(ctx.renderPos.y * 100) / 100 : -1
  r.phyX = Math.round(ctx.localPlayer.pos.x * 100) / 100
  r.phyY = Math.round(ctx.localPlayer.pos.y * 100) / 100
  r.canvasW = ctx.canvas?.width ?? 0
  r.canvasH = ctx.canvas?.height ?? 0
  r.dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
  r.ovDeath = overlayVisible('deathScreen')
  r.ovLobby = overlayVisible('lobbyModal')
  r.ovParams = overlayVisible('paramsModal')
  r.ovEditor = overlayVisible('inGameEditorModal')
  r.hidden = typeof document !== 'undefined' && document.hidden ? 1 : 0
  r.heapMB = heapMB()
  // 相对 60Hz 少画了几帧（1 = 正常；2 = 掉一帧；3 = 掉两帧）
  r.missedFrames = dt > 0 ? Math.max(1, Math.round(dt / 16.6667)) : 0

  diagStats.frames++
  diagStats.totalBusyMs += busyMs
  if (busyMs > diagStats.maxBusyMs) diagStats.maxBusyMs = busyMs

  // 页面隐藏/刚恢复时的超大 gap 是浏览器对后台标签页的正常 rAF 节流，不是真卡顿：
  // 单列为 throttledGaps 供参考，绝不能混进 gapsOver* 干扰真机定位。
  const pageHidden = typeof document !== 'undefined' && document.hidden
  const justVisible = r.hidden === 0 && lastFrameHidden === 1
  lastFrameHidden = r.hidden

  if (dt > FRAME_GAP_MS) {
    if (pageHidden || justVisible) {
      diagStats.throttledGaps++
    } else {
      if (dt > 100) diagStats.gapsOver100++
      else if (dt > 50) diagStats.gapsOver50++
      else diagStats.gapsOver24++
      if (dt > diagStats.worstGapMs) {
        diagStats.worstGapMs = Math.round(dt * 100) / 100
        diagStats.worstGapAt = Math.round(now)
        diagStats.worstGapIndex = currentIndex
      }
    }
    // 只有明显掉帧才记录详细现场
    if (stutters.length < MAX_STUTTERS) {
      stutters.push({
        i: currentIndex,
        t: Math.round(now),
        dt: Math.round(dt * 100) / 100,
        kind: 'frame-gap',
        detail: {
          severity: dt >= SEVERE_GAP_MS ? 'severe' : 'mild',
          steps: parts.steps,
          stepMs: r.stepMs,
          renderMs: r.renderMs,
          hudMs: r.hudMs,
          tick: r.tick,
          players: r.players,
          projectiles: r.projectiles,
          role: r.role,
          peers: r.peers,
          hp: r.hp,
          alive: r.alive,
          deployed: r.deployed,
          cam: `${r.camX},${r.camY}`,
          renderPos: `${r.renX},${r.renY}`,
          physPos: `${r.phyX},${r.phyY}`,
          canvas: `${r.canvasW}x${r.canvasH}@${r.dpr}`,
          overlays: `death=${r.ovDeath} lobby=${r.ovLobby} params=${r.ovParams} editor=${r.ovEditor}`,
          hidden: r.hidden,
          heapMB: r.heapMB,
        },
      })
    }
  }
  return currentIndex
}

/** 手动埋点：记录一次性事件（切枪/阵亡/开遮罩/画布重建等），便于对齐时间线 */
export function diagMark(kind: string, detail?: Record<string, unknown>): void {
  if (!enabled) return
  marks.push({ t: Math.round(performance.now()), i: currentIndex, kind, detail })
  if (marks.length > MAX_MARKS) marks.shift()
}

/** 安装长任务 / LoAF / 可见性 / 错误 观测器（幂等） */
export function installDiag(ctx?: () => FrameCtx): void {
  if (installed) return
  installed = true
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return

  const pushStutter = (rec: StutterRec): void => {
    if (!enabled) return
    if (stutters.length >= MAX_STUTTERS) stutters.shift()
    stutters.push(rec)
  }

  // 长任务（>50ms 的主线程阻塞）
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        pushStutter({
          i: currentIndex,
          t: Math.round(e.startTime),
          dt: Math.round(e.duration),
          kind: 'long-task',
          detail: {
            durationMs: Math.round(e.duration),
            name: e.name,
            entryType: e.entryType,
            // 交叉定位：落到哪个帧
            frameAt: currentIndex,
          },
        })
      }
    })
    po.observe({ type: 'longtask', buffered: false })
    observers.push(po)
  } catch { /* 不支持则忽略 */ }

  // LoAF：能给出渲染/样式/脚本分段，以及脚本归因
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const ev = e as unknown as {
          duration: number
          startTime: number
          renderStart?: number
          styleAndLayoutStart?: number
          blockedDuration?: number
          scripts?: { invoker?: string; sourceURL?: string; functionName?: string; duration?: number }[]
        }
        const renderMs = ev.renderStart ? ev.startTime + ev.duration - ev.renderStart : -1
        const styleMs = ev.styleAndLayoutStart ? ev.duration - (ev.styleAndLayoutStart - ev.startTime) : -1
        pushStutter({
          i: currentIndex,
          t: Math.round(ev.startTime),
          dt: Math.round(ev.duration),
          kind: 'loaf',
          detail: {
            durationMs: Math.round(ev.duration),
            renderMs: Math.round(renderMs),
            styleAndLayoutMs: Math.round(styleMs),
            blockedMs: Math.round(ev.blockedDuration ?? -1),
            scripts: (ev.scripts ?? []).slice(0, 5).map(s => ({
              invoker: s.invoker,
              src: s.sourceURL,
              fn: s.functionName,
              ms: s.duration ? Math.round(s.duration) : undefined,
            })),
          },
        })
      }
    })
    po.observe({ type: 'long-animation-frame', buffered: false })
    observers.push(po)
  } catch { /* 不支持则忽略 */ }

  // 页面可见性切换会暂停 rAF，回来时必然出现超大 gap —— 标记出来避免误判
  try {
    document.addEventListener('visibilitychange', () => {
      diagMark(document.hidden ? 'page-hidden' : 'page-visible')
    })
  } catch { /* ignore */ }

  // 未捕获异常也记下，避免把崩溃当成卡顿
  try {
    window.addEventListener('error', (ev) => {
      diagMark('error', { message: String(ev.message).slice(0, 200) })
    })
    window.addEventListener('unhandledrejection', (ev) => {
      diagMark('unhandledrejection', { reason: String((ev as PromiseRejectionEvent).reason).slice(0, 200) })
    })
  } catch { /* ignore */ }

  // 环境信息（只取一次）+ 真机专属探测
  diagMark('env', collectEnv())
  try {
    const p = probeEnvironment()
    Object.assign(lastEnvProbe, p)
    diagMark('env-probe', { ...p })
    // 采样 1.5s 估算刷新率与实际 FPS
    measureRefresh((hz, fps) => {
      diagMark('refresh-probe', { hz, fps })
    })
  } catch { /* ignore */ }
  void ctx
}

/** 真机环境探测：这些是区分"真卡顿"与"软件渲染正常"的关键。
 *  在软件渲染（SwiftShader）环境下这里会显示软件渲染器，而真机应显示真实 GPU。 */
export function probeEnvironment(): DiagEnvProbe {
  const probe: DiagEnvProbe = {
    refreshHz: 0,
    measuredFps: 0,
    webglRenderer: 'unknown',
    canvasAccel: 'unknown',
    cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0,
    deviceMemory: typeof navigator !== 'undefined'
      ? (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? -1
      : -1,
    batterySaver: false,
    visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
    dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'n/a',
  }
  // WebGL 渲染器：能判断是否被降级到软件渲染（SwiftShader = 无 GPU 加速）
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      probe.webglRenderer = ext
        ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
        : 'webgl(no-debug-info)'
    } else {
      probe.webglRenderer = 'webgl-unavailable'
    }
  } catch { /* ignore */ }
  // Canvas2D 加速状态：Chrome 会在 getContextAttributes 里暴露；
  // 拿不到时用 willReadFrequently 与已知软件渲染器名推断
  try {
    const cv = document.createElement('canvas')
    const c2 = cv.getContext('2d')
    const attrs = c2?.getContextAttributes?.() as { willReadFrequently?: boolean } | null
    const soft = /swiftshader|software|llvmpipe|basic render/i.test(probe.webglRenderer)
    probe.canvasAccel = soft
      ? 'likely-software (webgl renderer looks software)'
      : (attrs?.willReadFrequently ? 'cpu (willReadFrequently)' : 'likely-hardware')
  } catch { /* ignore */ }
  // 省电模式（Chrome 专有 getBattery）
  try {
    const nav = navigator as unknown as { getBattery?: () => Promise<{ charging: boolean }> }
    if (typeof nav.getBattery === 'function') {
      void nav.getBattery().then(b => { probe.batterySaver = !b.charging }).catch(() => {})
    }
  } catch { /* ignore */ }
  return probe
}

/** 用 rAF 采样估算显示器刷新率与实际 FPS（约 1.5 秒）。返回后回调写入 probe。 */
export function measureRefresh(onDone?: (hz: number, fps: number) => void): void {
  if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return
  const stamps: number[] = []
  let n = 0
  const t0 = performance.now()
  const tick = (ts: number): void => {
    stamps.push(ts)
    n++
    if (performance.now() - t0 < 1500 && n < 400) requestAnimationFrame(tick)
    else {
      const dts: number[] = []
      for (let i = 1; i < stamps.length; i++) dts.push(stamps[i] - stamps[i - 1])
      dts.sort((a, b) => a - b)
      const median = dts.length ? dts[Math.floor(dts.length / 2)] : 0
      const hz = median > 0 ? Math.round(1000 / median) : 0
      const span = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0
      const fps = span > 0 ? Math.round(((stamps.length - 1) / span) * 1000) : 0
      lastEnvProbe.refreshHz = hz
      lastEnvProbe.measuredFps = fps
      onDone?.(hz, fps)
    }
  }
  requestAnimationFrame(tick)
}

/** 最近一次环境探测结果（collectEnv/probeEnvironment 会更新它） */
const lastEnvProbe: DiagEnvProbe = {
  refreshHz: 0, measuredFps: 0, webglRenderer: 'unknown', canvasAccel: 'unknown',
  cores: 0, deviceMemory: -1, batterySaver: false, visibility: 'unknown', dpr: 1, viewport: 'n/a',
}

export function getEnvProbe(): DiagEnvProbe {
  return { ...lastEnvProbe }
}

function collectEnv(): Record<string, unknown> {
  try {
    return {
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
      dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
      screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : 'n/a',
      innerW: typeof window !== 'undefined' ? window.innerWidth : 0,
      innerH: typeof window !== 'undefined' ? window.innerHeight : 0,
      cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0,
      deviceMemory: typeof navigator !== 'undefined'
        ? (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? -1
        : -1,
      heapLimitMB: (() => {
        try {
          const m = (performance as unknown as { memory?: { jsHeapSizeLimit: number } }).memory
          return m ? Math.round(m.jsHeapSizeLimit / 1048576) : -1
        } catch { return -1 }
      })(),
      hasVisualViewport: typeof window !== 'undefined' && !!window.visualViewport,
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0,
    }
  } catch {
    return {}
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[i]
}

/** 按环形缓冲的时间顺序取出全部帧 */
export function diagFrames(): FrameRec[] {
  if (frameCount < RING) return frames.slice(0, frameCount)
  return [...frames.slice(frameCursor), ...frames.slice(0, frameCursor)]
}

export interface DiagReport {
  generatedAt: string
  env: Record<string, unknown>
  /** 真机环境探测：刷新率/实际FPS/GPU 渲染器/加速状态 —— 判断是否软件渲染的关键 */
  envProbe: DiagEnvProbe
  stats: typeof diagStats & {
    busyP50: number
    busyP95: number
    busyMax: number
    fpsAvg: number
    gapHistogram: Record<string, number>
    durationSec: number
  }
  stutters: StutterRec[]
  marks: DiagMark[]
  frames: FrameRec[]
}

export function buildReport(): DiagReport {
  const fs = diagFrames()
  const buses = fs.map(f => f.busyMs).sort((a, b) => a - b)
  const dts = fs.map(f => f.dt).filter(d => d > 0)
  const totalDt = dts.reduce((a, b) => a + b, 0)
  const hist: Record<string, number> = {
    '<=16.9': 0, '17-24': 0, '24-33': 0, '33-50': 0, '50-100': 0, '100-250': 0, '>250': 0,
  }
  for (const d of dts) {
    if (d <= 16.9) hist['<=16.9']++
    else if (d <= 24) hist['17-24']++
    else if (d <= 33) hist['24-33']++
    else if (d <= 50) hist['33-50']++
    else if (d <= 100) hist['50-100']++
    else if (d <= 250) hist['100-250']++
    else hist['>250']++
  }
  return {
    generatedAt: new Date().toISOString(),
    env: collectEnv(),
    envProbe: { ...lastEnvProbe },
    stats: {
      ...diagStats,
      busyP50: Math.round(percentile(buses, 0.5) * 1000) / 1000,
      busyP95: Math.round(percentile(buses, 0.95) * 1000) / 1000,
      busyMax: Math.round((buses[buses.length - 1] ?? 0) * 1000) / 1000,
      fpsAvg: totalDt > 0 ? Math.round((dts.length / totalDt) * 1000 * 100) / 100 : 0,
      gapHistogram: hist,
      durationSec: Math.round((totalDt / 1000) * 10) / 10,
    },
    stutters,
    marks,
    frames: fs,
  }
}

/** 人类可读摘要（便于直接粘贴到聊天/issue） */
export function reportToText(rep = buildReport()): string {
  const s = rep.stats
  const lines: string[] = []
  lines.push('=== SkyBlast 2D 诊断日志 ===')
  lines.push(`时间: ${rep.generatedAt}`)
  lines.push(`环境: ${JSON.stringify(rep.env)}`)
  const ep = rep.envProbe
  if (ep) {
    lines.push('')
    lines.push('--- 真机环境探测（判断是否软件渲染/是否掉帧的关键） ---')
    lines.push(`显示器刷新率: ${ep.refreshHz}Hz  ·  实测 rAF FPS: ${ep.measuredFps}`)
    lines.push(`WebGL 渲染器: ${ep.webglRenderer}`)
    lines.push(`Canvas 加速: ${ep.canvasAccel}`)
    lines.push(`CPU 核心 ${ep.cores} · 内存 ${ep.deviceMemory}GB · DPR ${ep.dpr} · 视口 ${ep.viewport}`)
    lines.push(`省电模式: ${ep.batterySaver ? '开（会限制 rAF）' : '关'} · 可见性: ${ep.visibility}`)
    const soft = /swiftshader|software|llvmpipe|basic render/i.test(ep.webglRenderer)
    if (soft) {
      lines.push('⚠️ 检测到软件渲染（无 GPU 加速）：画面卡顿源于浏览器/驱动未启用硬件加速，')
      lines.push('   不是游戏代码问题。请在浏览器设置里开启"使用硬件加速"，或更新显卡驱动。')
    }
    if (ep.refreshHz > 0 && ep.measuredFps > 0 && ep.measuredFps < ep.refreshHz * 0.85) {
      lines.push(`⚠️ 实测 FPS(${ep.measuredFps}) 明显低于刷新率(${ep.refreshHz})：存在掉帧。`)
    }
  }
  lines.push('')
  lines.push(`采样: ${s.frames} 帧 / ${s.durationSec}s，平均 ${s.fpsAvg} FPS`)
  lines.push(`掉帧计数: >24ms ${s.gapsOver24} 次，>50ms ${s.gapsOver50} 次，>100ms ${s.gapsOver100} 次`)
  lines.push(`后台节流(非卡顿): ${s.throttledGaps} 次（标签页切后台/切回时的正常 rAF 节流，已排除）`)
  lines.push(`最差帧间隔: ${s.worstGapMs}ms（第 ${s.worstGapIndex} 帧，t=${s.worstGapAt}ms）`)
  lines.push(`CPU 忙时: p50 ${s.busyP50}ms / p95 ${s.busyP95}ms / max ${s.busyMax}ms`)
  lines.push(`帧间隔分布: ${JSON.stringify(s.gapHistogram)}`)
  lines.push('')
  lines.push(`--- 掉帧现场（前 25 条，共 ${rep.stutters.length}） ---`)
  for (const st of rep.stutters.slice(0, 25)) {
    lines.push(`[#${st.i} t=${st.t} ${st.kind} ${st.dt}ms] ${JSON.stringify(st.detail)}`)
  }
  if (rep.marks.length) {
    lines.push('')
    lines.push(`--- 事件标记（${rep.marks.length} 条） ---`)
    for (const m of rep.marks.slice(-30)) {
      lines.push(`[#${m.i} t=${m.t}] ${m.kind} ${m.detail ? JSON.stringify(m.detail) : ''}`)
    }
  }
  return lines.join('\n')
}

function download(name: string, mime: string, content: string): void {
  try {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  } catch { /* ignore */ }
}

/** 导出：下载 json + txt，并返回文本摘要 */
export function diagExport(): string {
  const rep = buildReport()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const txt = reportToText(rep)
  download(`skyblast-diag-${stamp}.json`, 'application/json', JSON.stringify(rep, null, 1))
  download(`skyblast-diag-${stamp}.txt`, 'text/plain', txt)
  return txt
}

export function diagSetEnabled(v: boolean): void {
  enabled = v
}

export function diagIsEnabled(): boolean {
  return enabled
}

export function diagReset(): void {
  frames.length = 0
  frameCursor = 0
  frameCount = 0
  // 必须一并重置时间基准与帧号：否则 reset 后第一帧会算出"距上次记录很久"的假掉帧，
  // 且帧号从旧值继续递增，导出的日志会自相矛盾。
  lastFrameTs = 0
  currentIndex = 0
  stutters.length = 0
  marks.length = 0
  diagStats.frames = 0
  diagStats.gapsOver24 = 0
  diagStats.gapsOver50 = 0
  diagStats.gapsOver100 = 0
  diagStats.throttledGaps = 0
  lastFrameHidden = 0
  diagStats.worstGapMs = 0
  diagStats.worstGapAt = 0
  diagStats.worstGapIndex = 0
  diagStats.totalBusyMs = 0
  diagStats.maxBusyMs = 0
}

/** 控制台友好：打印最差帧表格 */
export function diagTable(n = 15): void {
  const fs = diagFrames()
  const worst = [...fs].sort((a, b) => b.dt - a.dt).slice(0, n)
  // eslint-disable-next-line no-console
  console.table(worst.map(f => ({
    帧: f.i, 间隔ms: f.dt, 步数: f.steps, stepMs: f.stepMs, renderMs: f.renderMs,
    hudMs: f.hudMs, tick: f.tick, 玩家: f.players, 弹丸: f.projectiles, 模式: f.role,
    遮罩: `d${f.ovDeath}l${f.ovLobby}`, 画布: `${f.canvasW}x${f.canvasH}`, 堆MB: f.heapMB,
  })))
}
