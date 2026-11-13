// web/app/hud.ts —— 战术 HUD / 右上角雷达小地图(替代顶栏A~J旗帜条，屏蔽敌军位置) / 死亡界面小地图选复活点 / 底部经典武器槽
import {
  world, localPlayer, pendingLoadout, mode, uiState, camera, canvas,
  featureFlags, toggleFeatureFlag, resetAllFeatureFlags,
} from './context.ts'
import type { FeatureFlags } from './context.ts'
import { diagStats } from './diag.ts'
import type { PlayerState } from '../../core/types.ts'
import {
  WEAPONS,
  SECONDARIES,
  isSecondaryUnlocked,
  getPlayerFragMaxCharges,
  formatWeaponCardSubtitle,
  formatSecondaryButtonTitle,
  formatSecondaryCardSubtitle,
} from '../../core/weapons.ts'
import { getPhysicsParams } from '../../core/sim/physics.ts'
import { isCapturePointSelectable, getNearbyInteractablePrompt } from '../../core/sim/world.ts'
import { WORLD_W, WORLD_H, SURFACE_Y, wrapDeltaX, wrapDeltaY, wrapDist, clamp } from '../../core/wrap.ts'
import { getFlagPalette, TEAM_PALETTE } from '../sprites.ts'
import { showToast } from './toast.ts'
import { netState, sendClientLoadoutToHost, probeHostRoomParamsByString, renderClientRoomParamsUI } from './net.ts'

// ── DOM 元素与状态脏检查缓存（消除 60Hz 每帧 30+ 次 getElementById 与无变更 DOM 重排） ──
const domCache = new Map<string, HTMLElement | null>()
const lastTextMap = new WeakMap<Element, string>()
const lastWidthMap = new WeakMap<HTMLElement, string>()
const lastHeightMap = new WeakMap<HTMLElement, string>()
const lastClassMap = new WeakMap<Element, string>()

function getEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return null
  let el = domCache.get(id)
  if (!el) {
    el = document.getElementById(id)
    if (el) domCache.set(id, el)
  }
  return (el as T) ?? null
}

function setTextIfChanged(el: Element | null | undefined, val: string): void {
  if (!el) return
  if (lastTextMap.get(el) === val && el.textContent === val) return
  lastTextMap.set(el, val)
  el.textContent = val
}

function setWidthIfChanged(el: HTMLElement | null | undefined, val: string): void {
  if (!el || !el.style) return
  if (lastWidthMap.get(el) === val) return
  lastWidthMap.set(el, val)
  el.style.width = val
}

function setHeightIfChanged(el: HTMLElement | null | undefined, val: string): void {
  if (!el || !el.style) return
  if (lastHeightMap.get(el) === val) return
  lastHeightMap.set(el, val)
  el.style.height = val
}

function setClassIfChanged(el: Element | null | undefined, cls: string): void {
  if (!el) return
  if (lastClassMap.get(el) === cls) return
  lastClassMap.set(el, cls)
  el.className = cls
}

/** 判断当前是否为 Host 权限（非 Client 客机） */
export function isHostAuthority(): boolean {
  return netState.role !== 'client' && uiState.lobbyRole !== 'client'
}

/**
 * 小地图战争迷雾过滤：小地图严格禁止显示敌方位置，仅允许显示玩家自身与同阵营友军。
 */
export function isFriendlyOnMinimap(p: PlayerState): boolean {
  if (p.id === localPlayer.id) return true
  if (mode.current === 'ffa' || localPlayer.team === 'ffa') return false
  return p.team === localPlayer.team
}

/** 同步红队 / 蓝队 / FFA 按钮可选状态（遵循房主 allowFfaInTeams 开关） */
export function syncTeamButtonsUI(): void {
  const ffaAllowed = mode.current === 'ffa' || mode.allowFfaInTeams
  if (mode.current === '2teams' && !mode.allowFfaInTeams && localPlayer.team === 'ffa') {
    localPlayer.team = 'red'
  }
  document.querySelectorAll('.team-select-btn').forEach((b) => {
    const t = b.getAttribute('data-team')
    const enabled = mode.current === '2teams'
      ? (t === 'red' || t === 'blue' || (t === 'ffa' && ffaAllowed))
      : (t === 'ffa')
    const sel = t === localPlayer.team
    ;(b as HTMLButtonElement).disabled = !enabled
    const activeBorder = t === 'red'
      ? 'border-2 border-rose-400 bg-rose-500/20 '
      : t === 'blue'
        ? 'border-2 border-sky-400 bg-sky-500/20 '
        : 'border-2 border-amber-400 bg-amber-500/20 '
    b.className = 'team-select-btn px-3 py-2 rounded-xl text-left transition flex items-center justify-between ' +
      (sel ? activeBorder : 'border border-slate-700 bg-slate-950/60 hover:border-slate-500 ') +
      (enabled ? '' : 'opacity-35 cursor-not-allowed')
  })

  const isClient = !isHostAuthority()
  document.querySelectorAll('.ffa-allow-btn').forEach((btn) => {
    const val = btn.getAttribute('data-allow-ffa') === '1'
    const sel = val === mode.allowFfaInTeams
    const disabled = isClient || mode.current === 'ffa'
    ;(btn as HTMLButtonElement).disabled = disabled
    btn.className = 'ffa-allow-btn px-2.5 py-1 rounded-lg text-xs font-extrabold transition ' +
      (sel
        ? (val ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white')
        : 'bg-slate-950 text-slate-400 border border-slate-700') +
      (disabled ? ' opacity-40 cursor-not-allowed' : '')
  })
}

/** 同步特性开关 (Feature Flags) 面板与顶栏计数徽章 */
export function syncFeatureFlagsUI(): void {
  const keys = Object.keys(featureFlags) as (keyof FeatureFlags)[]
  const enabledCount = keys.filter(k => featureFlags[k]).length
  const countEl = getEl('hudFlagsCountText')
  setTextIfChanged(countEl, `${enabledCount}/${keys.length}`)

  const toggleBtn = getEl('toggleFlagsHudBtn')
  const panel = getEl('hudFlagsPanel')
  if (toggleBtn) {
    toggleBtn.className = uiState.flagsHudOpen
      ? 'px-2 py-1 rounded-lg bg-emerald-400 text-slate-950 font-extrabold text-[11px] transition flex items-center gap-1 shadow-md'
      : 'px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 border border-emerald-400/50 text-[11px] font-extrabold transition flex items-center gap-1'
  }
  if (panel) {
    panel.classList.toggle('hidden', !uiState.flagsHudOpen)
  }

  document.querySelectorAll('.feature-flag-btn').forEach((btn) => {
    const key = btn.getAttribute('data-flag') as keyof FeatureFlags | null
    if (!key || !(key in featureFlags)) return
    const on = featureFlags[key]
    btn.className = 'feature-flag-btn w-full px-2.5 py-1.5 rounded-xl border text-left transition flex items-center justify-between gap-2 ' +
      (on
        ? 'border-emerald-400/60 bg-emerald-500/15 hover:bg-emerald-500/25'
        : 'border-slate-700/80 bg-slate-900/60 hover:border-slate-500 opacity-75')
    const pill = btn.querySelector('.flag-state-pill')
    if (pill) {
      pill.textContent = on ? '开启' : '关闭'
      pill.className = 'flag-state-pill px-2 py-0.5 rounded-md font-black text-[10px] shrink-0 ' +
        (on ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-400 border border-slate-700')
    }
  })

  const mmPanel = getEl('hudMinimapPanel')
  if (mmPanel) mmPanel.classList.toggle('hidden', !featureFlags.minimapRadar)
  if (!featureFlags.captureHudRing) {
    getEl('hudCaptureProgressCard')?.classList.add('hidden')
  }
}

export function syncSysBarUI(): void {
  const bar = getEl('topSystemToolbar')
  const btn = getEl('toggleSysBarBtn')
  if (bar) bar.classList.toggle('hidden', !uiState.sysBarOpen)
  if (btn) {
    btn.className = uiState.sysBarOpen
      ? 'glass-panel w-8 h-8 rounded-xl border border-cyan-400 bg-cyan-500/25 text-xs font-extrabold text-cyan-200 flex items-center justify-center shadow-xl transition'
      : 'glass-panel w-8 h-8 rounded-xl border border-slate-700/80 bg-slate-900/90 hover:bg-slate-800 active:scale-95 text-xs font-extrabold text-slate-200 flex items-center justify-center shadow-xl transition'
  }
}

export function toggleSysBar(): void {
  uiState.sysBarOpen = !uiState.sysBarOpen
  if (!uiState.sysBarOpen) {
    uiState.flagsHudOpen = false
    uiState.debugHudOpen = false
    syncFeatureFlagsUI()
    updateDebugHudVisibility()
  }
  syncSysBarUI()
}

export function toggleFlagsHud(): void {
  uiState.flagsHudOpen = !uiState.flagsHudOpen
  if (uiState.flagsHudOpen) {
    uiState.debugHudOpen = false
    updateDebugHudVisibility()
  }
  syncFeatureFlagsUI()
}

export function handleToggleFeatureFlagClick(key: keyof FeatureFlags): void {
  const next = toggleFeatureFlag(key)
  syncFeatureFlagsUI()
  showToast(`${next ? '✅ 已开启' : '⏸️ 已关闭'}特性开关：${key}`)
}

export function handleResetAllFeatureFlags(): void {
  resetAllFeatureFlags()
  syncFeatureFlagsUI()
  showToast('✅ 已重置：全部 6 项特性开关恢复默认开启')
}

/** 同步 Debug HUD 按钮与面板的显隐（平时隐藏，仅作为 Host 且主动点击开启时才显示） */
export function updateDebugHudVisibility(): void {
  const canDebug = isHostAuthority()
  if (!canDebug) {
    uiState.debugHudOpen = false
  }
  const toggleBtn = getEl('toggleDebugHudBtn')
  const panel = getEl('debugHudPanel')
  if (toggleBtn) {
    toggleBtn.classList.toggle('hidden', !canDebug)
    toggleBtn.className = canDebug
      ? (uiState.debugHudOpen
        ? 'px-2 py-1 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-[11px] transition flex items-center gap-1 shadow-md'
        : 'px-2 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-amber-300 border border-amber-500/40 font-semibold text-[11px] transition flex items-center gap-1')
      : 'hidden'
  }
  if (panel) {
    panel.classList.toggle('hidden', !(canDebug && uiState.debugHudOpen))
  }
}

/** 切换 Host 专属 Debug HUD 开关 */
export function toggleDebugHud(): void {
  if (!isHostAuthority()) {
    uiState.debugHudOpen = false
    updateDebugHudVisibility()
    showToast('🔒 Debug HUD 仅限 Host 开启')
    return
  }
  uiState.debugHudOpen = !uiState.debugHudOpen
  if (uiState.debugHudOpen) {
    uiState.flagsHudOpen = false
    syncFeatureFlagsUI()
  }
  updateDebugHudVisibility()
}

/** 刷新 Debug HUD 面板内的实时遥测数据 */
export function updateDebugHudTelemetry(fps = 60): void {
  if (!uiState.debugHudOpen || !isHostAuthority()) return
  const tickEl = getEl('dbgTickText')
  setTextIfChanged(tickEl, `Tick ${world.tick} · ${Math.round(fps)} FPS`)
  const posEl = getEl('dbgPosVelText')
  setTextIfChanged(posEl, `(${Math.round(localPlayer.pos.x)}, ${Math.round(localPlayer.pos.y)}) · v(${Math.round(localPlayer.vel.x)}, ${Math.round(localPlayer.vel.y)})`)
  const entEl = getEl('dbgEntitiesText')
  if (entEl) {
    let activeCrates = 0
    for (let i = 0; i < world.supplyCrates.length; i++) {
      if (world.supplyCrates[i].active) activeCrates++
    }
    setTextIfChanged(entEl, `弹丸 ${world.projectiles.length} · 掩体 ${world.obstacles.length} · 弹药 ${world.ammoPacks.length} · 特武 ${activeCrates}`)
  }
  // 诊断摘要：常开记录器的实时掉帧统计（点「导出诊断日志」可拿走完整日志）
  const diagEl = getEl('diagQuickStatus')
  if (diagEl) {
    setTextIfChanged(diagEl,
      `记录中 · 掉帧>24ms ${diagStats.gapsOver24} · >50ms ${diagStats.gapsOver50} · >100ms ${diagStats.gapsOver100}` +
      ` · 最差 ${diagStats.worstGapMs}ms · CPU峰值 ${Math.round(diagStats.maxBusyMs * 10) / 10}ms`)
  }
}

/** 同步大厅中的 Host 设置 vs Client 设置角色视图 */
export function syncLobbyRoleUI(nextRole?: 'host' | 'client'): void {
  if (nextRole) {
    if (nextRole === 'host' && netState.role === 'client') {
      showToast('⚠️ 请先断开联机再切回 Host')
      return
    }
    uiState.lobbyRole = nextRole
  }
  const isClient = uiState.lobbyRole === 'client' || netState.role === 'client'
  if (isClient) uiState.debugHudOpen = false
  updateDebugHudVisibility()

  const hostTab = getEl('lobbyTabHostBtn')
  const clientTab = getEl('lobbyTabClientBtn')
  if (hostTab) {
    hostTab.className = !isClient
      ? 'flex-1 py-2 px-4 rounded-xl border-2 border-emerald-400 bg-emerald-500/20 text-emerald-200 font-extrabold text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow'
      : 'flex-1 py-2 px-4 rounded-xl border border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200 font-bold text-xs sm:text-sm transition flex items-center justify-center gap-2'
  }
  if (clientTab) {
    clientTab.className = isClient
      ? 'flex-1 py-2 px-4 rounded-xl border-2 border-sky-400 bg-sky-500/20 text-sky-200 font-extrabold text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow'
      : 'flex-1 py-2 px-4 rounded-xl border border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200 font-bold text-xs sm:text-sm transition flex items-center justify-center gap-2'
  }

  getEl('hostKcpSection')?.classList.toggle('hidden', isClient)
  getEl('clientKcpSection')?.classList.toggle('hidden', !isClient)
  getEl('hostRoomParamsCard')?.classList.toggle('opacity-50', isClient)

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    ;(btn as HTMLButtonElement).disabled = isClient
    btn.classList.toggle('opacity-40', isClient)
    btn.classList.toggle('cursor-not-allowed', isClient)
  })
  document.querySelectorAll('.bot-count-btn').forEach((btn) => {
    ;(btn as HTMLButtonElement).disabled = isClient
    btn.classList.toggle('opacity-40', isClient)
    btn.classList.toggle('cursor-not-allowed', isClient)
  })
  const openParamsLobbyBtn = getEl<HTMLButtonElement>('lobbyOpenParamsBtn')
  if (openParamsLobbyBtn) {
    openParamsLobbyBtn.disabled = isClient
    openParamsLobbyBtn.classList.toggle('hidden', isClient)
  }

  syncTeamButtonsUI()

  const startBtnText = getEl('startBattleBtnText')
  setTextIfChanged(startBtnText, '进入房间')

  if (isClient) {
    const inp = getEl<HTMLInputElement>('peerRemoteIdInput')
    const raw = inp?.value?.trim() || ''
    if (raw) {
      probeHostRoomParamsByString(raw)
    } else {
      renderClientRoomParamsUI(netState.hostRoomParams)
    }
  }
}

let lastLoadoutTextSig = ''
/** 将死亡界面与待机大厅中的主/副武器卡片文案统一同步自 core/weapons.ts + world.config */
export function syncLoadoutTextFromSingleSource(): void {
  const sig = `${WEAPONS[0]?.magSize}:${WEAPONS[1]?.magSize}:${WEAPONS[2]?.magSize}:${world.config.fragRechargeSeconds}:${world.config.shieldHp}`
  if (sig === lastLoadoutTextSig) return
  lastLoadoutTextSig = sig

  document.querySelectorAll('.death-wep-btn').forEach((btn) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    const wep = WEAPONS[slot]
    if (!wep) return
    const divs = btn.querySelectorAll('div')
    if (divs[0]) setTextIfChanged(divs[0], wep.shortName)
    if (divs[1]) setTextIfChanged(divs[1], formatWeaponCardSubtitle(wep))
  })

  document.querySelectorAll('.lobby-wep-btn').forEach((btn, idx) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    const wep = WEAPONS[slot]
    if (!wep) return
    const divs = btn.querySelectorAll('div')
    if (divs[0]) setTextIfChanged(divs[0], `${idx + 1}. ${wep.shortName}`)
    if (divs[1]) setTextIfChanged(divs[1], formatWeaponCardSubtitle(wep))
  })

  document.querySelectorAll('.death-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec') || 'frag'
    const def = SECONDARIES[sec]
    if (!def) return
    setTextIfChanged(btn, formatSecondaryButtonTitle(def, true))
  })

  document.querySelectorAll('.lobby-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec') || 'frag'
    const def = SECONDARIES[sec]
    if (!def) return
    const divs = btn.querySelectorAll('div')
    if (divs[0]) setTextIfChanged(divs[0], formatSecondaryButtonTitle(def, false))
    if (divs[1]) setTextIfChanged(divs[1], formatSecondaryCardSubtitle(def, world.config))
  })
}

export function updateHudWeaponButtons(): void {
  syncLoadoutTextFromSingleSource()
  const streak = localPlayer.deathStreak ?? 0
  const dollCharges = localPlayer.dollCharges ?? 0
  const wepIdx = pendingLoadout.weaponIndex

  if (!isSecondaryUnlocked(pendingLoadout.secondaryType, streak, dollCharges, wepIdx)) {
    pendingLoadout.secondaryType = 'frag'
    localPlayer.secondary = 'frag'
  }

  document.querySelectorAll('.death-wep-btn').forEach((btn) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    setClassIfChanged(
      btn,
      slot === wepIdx
        ? 'death-wep-btn px-2.5 py-2 rounded-xl border-2 border-emerald-400 bg-emerald-500/20 text-left transition'
        : 'death-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500',
    )
  })
  document.querySelectorAll('.death-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec') || 'frag'
    const unlocked = isSecondaryUnlocked(sec, streak, dollCharges, wepIdx)
    const isSelected = sec === pendingLoadout.secondaryType
    setClassIfChanged(
      btn,
      'death-sec-btn px-2.5 py-1.5 rounded-lg border text-xs transition ' +
        (isSelected
          ? 'border-2 border-rose-400 bg-rose-500/20 font-extrabold text-white'
          : unlocked
            ? 'border-slate-600 bg-slate-900/90 font-semibold text-slate-200 hover:border-rose-400/60'
            : 'border-slate-800 bg-slate-950/40 font-semibold text-slate-500 opacity-55 cursor-not-allowed'),
    )
    ;(btn as HTMLButtonElement).disabled = !unlocked
  })
  const streakNote = getEl('deathSecNote')
  setTextIfChanged(streakNote, wepIdx === 8 ? `+1挡` : '')

  document.querySelectorAll('.lobby-wep-btn').forEach((btn) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    setClassIfChanged(
      btn,
      slot === wepIdx
        ? 'lobby-wep-btn px-2.5 py-2 rounded-xl border-2 border-amber-400 bg-amber-500/20 text-left transition'
        : 'lobby-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500',
    )
  })
  document.querySelectorAll('.lobby-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec') || 'frag'
    const unlocked = isSecondaryUnlocked(sec, streak, dollCharges, wepIdx)
    if (!unlocked) {
      setClassIfChanged(btn, 'lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-800 bg-slate-950/40 text-left transition cursor-not-allowed opacity-60')
    } else {
      setClassIfChanged(
        btn,
        sec === pendingLoadout.secondaryType
          ? 'lobby-sec-btn px-2.5 py-2 rounded-xl border-2 border-rose-400 bg-rose-500/20 text-left transition'
          : 'lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500',
      )
    }
    ;(btn as HTMLButtonElement).disabled = !unlocked
  })
}

export function updateSpawnPointButtonsUI(): void {
  const isFfaTeam = localPlayer.team === 'ffa'
  document.querySelectorAll('.spawn-select-btn').forEach((btn) => {
    const spId = btn.getAttribute('data-spawn') || 'base'
    if (spId === 'base') {
      setTextIfChanged(btn, isFfaTeam ? '🎲 随机出生' : '🏠 基地')
    }
    let unlocked = spId === 'base'
    if (spId !== 'base') {
      const cp = world.capturePoints.find(c => c.id === spId)
      unlocked = isCapturePointSelectable(cp, localPlayer.team)
    }
    const isSelected = pendingLoadout.spawnPointId === spId
    if (!unlocked) setClassIfChanged(btn, 'spawn-select-btn px-2 py-1 rounded-lg border-2 border-slate-800 bg-slate-950/40 text-slate-600 text-[11px] font-semibold cursor-not-allowed')
    else if (isSelected) setClassIfChanged(btn, 'spawn-select-btn px-2 py-1 rounded-lg border-2 border-emerald-400 bg-emerald-500/20 text-emerald-200 text-[11px] font-extrabold')
    else setClassIfChanged(btn, 'spawn-select-btn px-2 py-1 rounded-lg border-2 border-slate-700 bg-slate-900 text-slate-200 text-[11px] font-semibold hover:border-emerald-400/50')
  })

  let label = isFfaTeam ? '🎲 随机出生' : '🏠 基地'
  const activeId = pendingLoadout.spawnPointId || localPlayer.selectedSpawnId || 'base'
  if (activeId !== 'base') {
    const cp = world.capturePoints.find(c => c.id === activeId)
    if (cp && isCapturePointSelectable(cp, localPlayer.team)) {
      label = `🚩${cp.code} ${cp.name.replace(/^[A-J]·/, '')}`
    } else {
      pendingLoadout.spawnPointId = 'base'
      localPlayer.selectedSpawnId = 'base'
    }
  }

  setTextIfChanged(getEl('hudCurrentSpawnBtn'), label)
  setTextIfChanged(getEl('deathSelectedSpawnBadge'), label)
  renderDeathMinimap()
}

/** 选定指定复活点 ID（供右上角雷达、死亡界面小地图、基地按钮与大厅按钮共用） */
export function selectSpawnPointById(spId: string, silent = false): boolean {
  if (spId !== 'base') {
    const cp = world.capturePoints.find(c => c.id === spId)
    if (!isCapturePointSelectable(cp, localPlayer.team)) {
      if (!silent) showToast(`⚠️ 需先占领【${cp ? `[${cp.code}] ${cp.name}` : spId}】才可作为复活点`)
      return false
    }
  }
  pendingLoadout.spawnPointId = spId
  localPlayer.selectedSpawnId = spId
  updateSpawnPointButtonsUI()
  renderHudMinimap()
  if (netState.role === 'client') sendClientLoadoutToHost(false)
  if (!silent) {
    if (spId === 'base') {
      showToast(localPlayer.team === 'ffa' ? '🎲 已切换复活点：随机安全点' : '🏠 已切换复活点：队伍主基地')
    } else {
      const cp = world.capturePoints.find(c => c.id === spId)
      showToast(`🚩 已选【[${cp?.code}] ${cp?.name}】作为复活点`)
    }
  }
  return true
}

/** 点击左上角当前复活点按钮：在基地与已占领据点之间循环切换 */
export function cycleSelectedSpawnPoint(): void {
  const options: string[] = ['base']
  for (const cp of world.capturePoints) {
    if (cp.y > 400 && isCapturePointSelectable(cp, localPlayer.team)) {
      options.push(cp.id)
    }
  }
  const cur = pendingLoadout.spawnPointId || localPlayer.selectedSpawnId || 'base'
  const idx = options.indexOf(cur)
  const next = options[(idx + 1) % options.length] ?? 'base'
  selectSpawnPointById(next)
}

/** 点击右上角雷达小地图或死亡界面小地图：选择基地或最近的已占领据点作为复活点 */
export function handleMinimapClick(clientX: number, clientY: number, canvasId = 'hudMinimapCanvas'): void {
  const mm = getEl<HTMLCanvasElement>(canvasId)
  if (!mm) return
  const rect = mm.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const wx = clamp(((clientX - rect.left) / rect.width) * WORLD_W, 0, WORLD_W)
  const wy = clamp(((clientY - rect.top) / rect.height) * WORLD_H, 0, WORLD_H)

  if (localPlayer.team !== 'ffa') {
    const baseX = localPlayer.team === 'blue' ? 12940 : 260
    const baseY = 3264
    const baseDist = wrapDist(wx, wy, baseX, baseY)
    if (baseDist <= 950) {
      selectSpawnPointById('base')
      return
    }
  }

  let bestCp: typeof world.capturePoints[0] | null = null
  let bestDist = Infinity
  for (const cp of world.capturePoints) {
    if (cp.y <= 400) continue
    const d = wrapDist(wx, wy, cp.x, cp.y)
    if (d < bestDist) {
      bestDist = d
      bestCp = cp
    }
  }
  if (!bestCp || bestDist > 1400) return
  selectSpawnPointById(bestCp.id)
}

export function tryChangePrimaryWeapon(slotIdx: number): void {
  const wep = WEAPONS[slotIdx]
  if (!wep || wep.isSupplyOnly) return
  if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
    showToast('🔒 阵亡重生时生效')
    return
  }
  pendingLoadout.weaponIndex = slotIdx
  localPlayer.weaponIndex = slotIdx
  localPlayer.lastPrimaryIndex = slotIdx
  const streak = localPlayer.deathStreak ?? 0
  if (!isSecondaryUnlocked(pendingLoadout.secondaryType, streak, localPlayer.dollCharges ?? 0, slotIdx)) {
    pendingLoadout.secondaryType = 'frag'
    localPlayer.secondary = 'frag'
  }
  updateHudWeaponButtons()
  if (netState.role === 'client') sendClientLoadoutToHost(false)
}

export function tryChangeSecondaryWeapon(secType: string): void {
  const def = SECONDARIES[secType]
  if (!def) return
  const streak = localPlayer.deathStreak ?? 0
  const dollCharges = localPlayer.dollCharges ?? 0
  const unlocked = isSecondaryUnlocked(secType, streak, dollCharges, pendingLoadout.weaponIndex)
  if (!unlocked) {
    showToast(`🔒 需连死 ${def.unlockStreak} 次解锁`)
    return
  }
  if (secType === 'doll' && localPlayer.deployed && localPlayer.respawnTimer <= 0 && dollCharges > 0) {
    localPlayer.secondary = secType
    updateHudWeaponButtons()
    showToast(`🎎 替身人偶 ×${dollCharges}`)
    return
  }
  if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
    showToast('🔒 阵亡重生时生效')
    return
  }
  pendingLoadout.secondaryType = secType
  localPlayer.secondary = secType
  updateHudWeaponButtons()
  if (netState.role === 'client') sendClientLoadoutToHost(false)
}

/** 更新屏幕中下方沉浸式据点占领双向读条卡片（受 featureFlags.captureHudRing 控制，无占点音效） */
function updateCaptureProgressCardUI(): void {
  const card = getEl('hudCaptureProgressCard')
  if (!card) return
  if (!featureFlags.captureHudRing || !localPlayer.deployed || !localPlayer.alive || localPlayer.respawnTimer > 0) {
    card.classList.add('hidden')
    return
  }

  const capR = Math.max(150, world.config.captureRadius + 35)
  let activeCp: typeof world.capturePoints[0] | null = null
  let bestDist = Infinity
  for (let i = 0; i < world.capturePoints.length; i++) {
    const cp = world.capturePoints[i]
    if (cp.y <= 400) continue
    const dx = Math.abs(wrapDeltaX(localPlayer.pos.x, cp.x))
    const dy = wrapDeltaY(cp.y, localPlayer.pos.y)
    if (dx >= capR || dy > 28 || dy < -115) continue
    const d = Math.hypot(dx, dy)
    if (d < capR && d < bestDist) {
      bestDist = d
      activeCp = cp
    }
  }

  if (!activeCp) {
    card.classList.add('hidden')
    return
  }

  card.classList.remove('hidden')
  const titleEl = getEl('hudCapCardTitle')
  const pctEl = getEl('hudCapCardPct')
  const barEl = getEl('hudCapCardBar')
  const phaseEl = getEl('hudCapCardPhase')
  const synEl = getEl('hudCapCardSynergy')

  let myCount = 0
  let enemyCount = 0
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]
    if (!p.deployed || !p.alive || p.respawnTimer > 0) continue
    const dx = Math.abs(wrapDeltaX(p.pos.x, activeCp.x))
    const dy = wrapDeltaY(activeCp.y, p.pos.y)
    if (dx < capR && dy <= 28 && dy >= -115 && Math.hypot(dx, dy) < capR) {
      if (p.team === localPlayer.team) myCount++
      else enemyCount++
    }
  }

  const pct = Math.round(clamp(activeCp.progress, 0, 100))
  const curTeam = activeCp.progress > 0 ? (activeCp.ownerTeam ?? activeCp.capturingTeam) : null
  const isNeutralizing = curTeam !== null && curTeam !== localPlayer.team && activeCp.progress > 0
  const isFullyOwned = activeCp.ownerTeam === localPlayer.team && activeCp.progress >= 100

  setTextIfChanged(titleEl, `🚩 ${activeCp.code}`)
  setTextIfChanged(pctEl, `${pct}%`)
  if (synEl) {
    if (myCount >= 2 && !isFullyOwned) {
      synEl.classList.remove('hidden')
      setTextIfChanged(synEl, `×${myCount}`)
    } else {
      synEl.classList.add('hidden')
    }
  }

  if (barEl) {
    setWidthIfChanged(barEl, `${pct}%`)
    const col = curTeam === 'red' ? 'bg-rose-500' : curTeam === 'blue' ? 'bg-sky-500' : curTeam === 'ffa' ? 'bg-amber-400' : 'bg-slate-400'
    setClassIfChanged(barEl, `h-full ${col}`)
  }

  if (phaseEl) {
    if (isFullyOwned) {
      const isSel = pendingLoadout.spawnPointId === activeCp.id || localPlayer.selectedSpawnId === activeCp.id
      setTextIfChanged(
        phaseEl,
        isSel
          ? '✅ 已完全占领并选作复活点 (100%)'
          : '✅ 已完全占领 (100%) · 按 [E] 选为复活点',
      )
      setClassIfChanged(phaseEl, 'text-[10px] font-bold text-emerald-300 text-center')
    } else if (enemyCount > 0 && myCount <= enemyCount) {
      setTextIfChanged(phaseEl, `⚡ 争夺受阻（圈内我方 ${myCount} : 敌方 ${enemyCount}）`)
      setClassIfChanged(phaseEl, 'text-[10px] font-bold text-amber-300 text-center')
    } else if (isNeutralizing) {
      setTextIfChanged(phaseEl, `⚔️ 阶段1：中和敌方进度 (${pct}% → 0% 后转为己方占领)`)
      setClassIfChanged(phaseEl, 'text-[10px] font-bold text-rose-300 text-center')
    } else {
      setTextIfChanged(phaseEl, `🚩 阶段2：己方占领读条 (${pct}% → 100%)`)
      setClassIfChanged(phaseEl, 'text-[10px] font-bold text-cyan-300 text-center')
    }
  }
}

/**
 * 通用战术小地图绘制核心：
 * - 同时服务于右上角雷达 (#hudMinimapCanvas) 与死亡界面复活点选择地图 (#deathMinimapCanvas)
 * - 严格遵守战争迷雾：只绘制自身与同队友军 (isFriendlyOnMinimap)，绝不绘制敌方玩家位置！
 * - 绘制全部 10 个旗帜据点 (A~J) 的代号、旗帜颜色、占领进度环与当前选中的复活点绿框。
 */
const minimapBgCache = new Map<string, HTMLCanvasElement>()
const MINIMAP_BASES: readonly { team: 'red' | 'blue'; x: number; y: number; color: string; label: string }[] = [
  { team: 'red', x: 260, y: 3264, color: '#f43f5e', label: '🏠红' },
  { team: 'blue', x: 12940, y: 3264, color: '#0ea5e9', label: '🏠蓝' },
]

function getMinimapStaticBg(W: number, H: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
  const key = `${W}x${H}:${world.terrain.rects.length}`
  const bg = minimapBgCache.get(key)
  if (bg) return bg
  const cv = document.createElement('canvas')
  if (typeof cv.getContext !== 'function') return null
  cv.width = W
  cv.height = H
  const bc = cv.getContext('2d')
  if (!bc || typeof bc.fillRect !== 'function') return null
  const sx = (wx: number) => (wx / WORLD_W) * W
  const sy = (wy: number) => (wy / WORLD_H) * H
  bc.fillStyle = '#040814'
  bc.fillRect(0, 0, W, H)
  bc.strokeStyle = 'rgba(56, 189, 248, 0.25)'
  bc.lineWidth = 1
  if (typeof bc.beginPath === 'function') {
    bc.beginPath()
    bc.moveTo(0, sy(SURFACE_Y))
    bc.lineTo(W, sy(SURFACE_Y))
    bc.stroke()
  }
  bc.fillStyle = 'rgba(51, 65, 85, 0.75)'
  for (let i = 0; i < world.terrain.rects.length; i++) {
    const r = world.terrain.rects[i]
    if (r.kind.startsWith('deco_') || r.kind.endsWith('_bg')) continue
    bc.fillRect(sx(r.x), sy(r.y), Math.max(1.2, (r.w / WORLD_W) * W), Math.max(1.2, (r.h / WORLD_H) * H))
  }
  minimapBgCache.set(key, cv)
  return cv
}

function drawTacticalMinimapOnCanvas(mm: HTMLCanvasElement, isDeathMap: boolean): void {
  if (typeof mm.getContext !== 'function') return
  const c = mm.getContext('2d')
  if (!c || typeof c.clearRect !== 'function') return

  const W = mm.width || (isDeathMap ? 528 : 252)
  const H = mm.height || (isDeathMap ? 168 : 82)
  const scaleX = W / WORLD_W
  const scaleY = H / WORLD_H

  const staticBg = typeof c.drawImage === 'function' ? getMinimapStaticBg(W, H) : null
  if (staticBg) {
    c.drawImage(staticBg, 0, 0)
  } else {
    c.clearRect(0, 0, W, H)
    c.fillStyle = '#040814'
    c.fillRect(0, 0, W, H)
    c.strokeStyle = 'rgba(56, 189, 248, 0.25)'
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(0, SURFACE_Y * scaleY)
    c.lineTo(W, SURFACE_Y * scaleY)
    c.stroke()
    c.fillStyle = 'rgba(51, 65, 85, 0.75)'
    for (let i = 0; i < world.terrain.rects.length; i++) {
      const r = world.terrain.rects[i]
      if (r.kind.startsWith('deco_') || r.kind.endsWith('_bg')) continue
      c.fillRect(r.x * scaleX, r.y * scaleY, Math.max(1.2, r.w * scaleX), Math.max(1.2, r.h * scaleY))
    }
  }

  const activeSpawnId = pendingLoadout.spawnPointId || localPlayer.selectedSpawnId || 'base'

  for (let i = 0; i < MINIMAP_BASES.length; i++) {
    const b = MINIMAP_BASES[i]
    const bx = b.x * scaleX
    const by = b.y * scaleY
    const isMyBase = localPlayer.team === b.team
    const isSelectedBase = isMyBase && activeSpawnId === 'base'
    c.fillStyle = b.color
    const rSize = isDeathMap ? 5 : 3.2
    c.fillRect(bx - rSize, by - rSize, rSize * 2, rSize * 2)
    if (isSelectedBase) {
      c.strokeStyle = '#10b981'
      c.lineWidth = isDeathMap ? 2.2 : 1.5
      c.strokeRect(bx - rSize - 2.5, by - rSize - 2.5, (rSize + 2.5) * 2, (rSize + 2.5) * 2)
    }
    if (isDeathMap && typeof c.fillText === 'function') {
      c.font = 'bold 9px monospace'
      c.fillStyle = isSelectedBase ? '#6ee7b7' : '#e2e8f0'
      c.fillText(b.label, b.team === 'red' ? bx + 6 : bx - 24, by - 5)
    }
  }

  for (let i = 0; i < world.supplyCrates.length; i++) {
    const cr = world.supplyCrates[i]
    if (!cr.active) continue
    c.fillStyle = cr.kind === 'doll' ? '#f472b6' : '#fde047'
    const sz = isDeathMap ? 4 : 2.6
    c.fillRect(cr.x * scaleX - sz / 2, cr.y * scaleY - sz / 2, sz, sz)
  }

  for (let i = 0; i < world.capturePoints.length; i++) {
    const cp = world.capturePoints[i]
    if (cp.y <= 400) continue
    const pal = getFlagPalette(cp)
    const cx = cp.x * scaleX
    const cy = cp.y * scaleY
    const selectable = isCapturePointSelectable(cp, localPlayer.team)
    const isSel = selectable && activeSpawnId === cp.id
    const dotR = isDeathMap ? 5.2 : 3.1

    if (cp.progress > 0 && cp.progress < 100) {
      c.strokeStyle = pal.light
      c.lineWidth = isDeathMap ? 1.8 : 1.2
      c.beginPath()
      c.arc(cx, cy, dotR + 2.2 + Math.sin(world.tick * 0.2) * 1.2, 0, Math.PI * 2)
      c.stroke()
    }
    c.fillStyle = pal.color
    c.beginPath()
    c.arc(cx, cy, dotR, 0, Math.PI * 2)
    c.fill()

    if (selectable && !isSel) {
      c.strokeStyle = 'rgba(16, 185, 129, 0.7)'
      c.lineWidth = 1.2
      c.beginPath()
      c.arc(cx, cy, dotR + 2, 0, Math.PI * 2)
      c.stroke()
    }
    if (isSel) {
      c.strokeStyle = '#10b981'
      c.lineWidth = isDeathMap ? 2.2 : 1.6
      const box = dotR + (isDeathMap ? 3.5 : 2.2)
      c.strokeRect(cx - box, cy - box, box * 2, box * 2)
    }
    if (typeof c.fillText === 'function') {
      c.font = isDeathMap ? 'bold 10px monospace' : 'bold 7.5px monospace'
      c.fillStyle = isSel ? '#6ee7b7' : selectable ? '#ffffff' : 'rgba(226,232,240,0.88)'
      c.fillText(cp.code, cx - (isDeathMap ? 3.2 : 2.2), cy - dotR - (isDeathMap ? 3 : 1.8))
    }
  }

  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]
    if (!isFriendlyOnMinimap(p)) continue
    if (!p.deployed) continue
    const px = p.pos.x * scaleX
    const py = p.pos.y * scaleY
    if (p.id === localPlayer.id) {
      if (!p.alive || p.respawnTimer > 0) {
        c.strokeStyle = '#f43f5e'
        c.lineWidth = 1.6
        c.beginPath()
        c.moveTo(px - 3.5, py - 3.5)
        c.lineTo(px + 3.5, py + 3.5)
        c.moveTo(px + 3.5, py - 3.5)
        c.lineTo(px - 3.5, py + 3.5)
        c.stroke()
      } else {
        c.fillStyle = '#ffffff'
        c.beginPath()
        c.arc(px, py, isDeathMap ? 4.2 : 3.2, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = '#22d3ee'
        c.lineWidth = 1.3
        c.stroke()
      }
    } else if (p.alive && p.respawnTimer <= 0) {
      const pal = TEAM_PALETTE[p.team] ?? TEAM_PALETTE.red
      c.fillStyle = pal.color
      c.beginPath()
      c.arc(px, py, isDeathMap ? 3.0 : 2.2, 0, Math.PI * 2)
      c.fill()
    }
  }

  if (!isDeathMap && canvas) {
    const vw = ((canvas.width * camera.fovFactor) / WORLD_W) * W
    const vh = ((canvas.height * camera.fovFactor) / WORLD_H) * H
    c.strokeStyle = 'rgba(226, 232, 240, 0.32)'
    c.lineWidth = 1
    c.strokeRect(camera.x * scaleX - vw / 2, camera.y * scaleY - vh / 2, vw, vh)
  }
}

/** 渲染右上角全景战术雷达小地图（受 featureFlags.minimapRadar 控制） */
export function renderHudMinimap(): void {
  const panel = getEl('hudMinimapPanel')
  if (!featureFlags.minimapRadar) {
    panel?.classList.add('hidden')
    return
  }
  panel?.classList.remove('hidden')

  const coordEl = getEl('hudZoneCoordText')
  if (coordEl) {
    const px = Math.round(localPlayer.pos.x)
    const py = Math.round(localPlayer.pos.y)
    const zone = py < 1200 ? '高空拱顶' : py < 2800 ? '中层空岛' : py <= SURFACE_Y + 40 ? '主地面层' : '地下通道'
    setTextIfChanged(coordEl, `${px},${py} · ${zone}`)
  }

  const mm = getEl<HTMLCanvasElement>('hudMinimapCanvas')
  if (mm) drawTacticalMinimapOnCanvas(mm, false)
}

/** 渲染死亡界面的复活点选择小地图 */
export function renderDeathMinimap(): void {
  const mm = getEl<HTMLCanvasElement>('deathMinimapCanvas')
  if (mm) drawTacticalMinimapOnCanvas(mm, true)
}

export function updateHudUI(): void {
  setTextIfChanged(getEl('hudPlayerName'), localPlayer.name)

  const fovBadge = getEl('hudSniperFovBadge')
  if (fovBadge) {
    const wepForFov = WEAPONS[localPlayer.weaponIndex]
    if (localPlayer.mountedTowerId) {
      setTextIfChanged(fovBadge, '🗼 200%')
      fovBadge.classList.remove('hidden')
    } else if ((wepForFov?.fovMult ?? 1) > 1.01) {
      const charge = (wepForFov?.chargeSeconds ?? 0) > 0 && localPlayer.chargeTimer > 0
        ? ` ${Math.min(100, Math.round(localPlayer.chargeTimer / (wepForFov?.chargeSeconds ?? 1) * 100))}%`
        : ''
      setTextIfChanged(fovBadge, `🔭 +30%${charge}`)
      fovBadge.classList.remove('hidden')
    } else fovBadge.classList.add('hidden')
  }

  const hpPct = Math.round(clamp((localPlayer.hp / localPlayer.maxHp) * 100, 0, 100))
  setWidthIfChanged(getEl('hudHpBar'), `${hpPct}%`)

  const hasShield = localPlayer.shieldTimer > 0 && localPlayer.shieldHp > 0
  const shieldPct = hasShield ? Math.round(clamp((localPlayer.shieldHp / world.config.shieldHp) * 100, 0, 100)) : 0
  setWidthIfChanged(getEl('hudShieldBar'), `${shieldPct}%`)

  const hpText = getEl('hudHpText')
  if (hpText) {
    const hpNum = Math.max(0, Math.round(localPlayer.hp))
    setTextIfChanged(
      hpText,
      hasShield
        ? `❤️${hpNum} + 🛡️${Math.round(localPlayer.shieldHp)}`
        : `${hpNum} / ${localPlayer.maxHp}`,
    )
  }

  const fuelMaxNow = getPhysicsParams().jetpackFuel * (WEAPONS[localPlayer.weaponIndex]?.fuelMult ?? 1)
  const fuelPct = Math.round(clamp((localPlayer.fuel / Math.max(0.001, fuelMaxNow)) * 100, 0, 100))
  setWidthIfChanged(getEl('hudFuelBar'), `${fuelPct}%`)
  setTextIfChanged(getEl('hudFuelPctText'), `🚀 ${fuelPct}%`)

  const streak = localPlayer.deathStreak ?? 0
  const dollCharges = localPlayer.dollCharges ?? 0
  setTextIfChanged(getEl('hudStreakCountBadge'), `连死 ${streak}`)

  const pipsEl = getEl('hudUnlockTierPips')
  if (pipsEl) {
    const wIdx = localPlayer.weaponIndex
    const p1 = isSecondaryUnlocked('obstacle', streak, dollCharges, wIdx) ? '🧱✓' : '🧱1'
    const p2 = isSecondaryUnlocked('shield', streak, dollCharges, wIdx) ? '🛡️✓' : '🛡️2'
    const p3 = isSecondaryUnlocked('teleport', streak, dollCharges, wIdx) ? '🌀✓' : '🌀3'
    const p4 = isSecondaryUnlocked('doll', streak, dollCharges, wIdx) ? '🎎✓' : '🎎4'
    setTextIfChanged(pipsEl, `💣✓ ${p1} ${p2} ${p3} ${p4}`)
  }

  const buffsEl = getEl('hudActiveBuffsText')
  let mounted: typeof world.mortars[0] | undefined
  for (let i = 0; i < world.mortars.length; i++) {
    if (world.mortars[i].operatorId === localPlayer.id) {
      mounted = world.mortars[i]
      break
    }
  }
  if (buffsEl) {
    let buffStr = ''
    if (hasShield) buffStr += `🛡️${Math.round(localPlayer.shieldHp)}(${localPlayer.shieldTimer.toFixed(1)}s)`
    if (localPlayer.doll) buffStr += (buffStr ? ' · ' : '') + `🎎${localPlayer.doll.timer.toFixed(1)}s`
    if (localPlayer.mountedTowerId) buffStr += (buffStr ? ' · ' : '') + '🗼瞭望200%'
    if (mounted) buffStr += (buffStr ? ' · ' : '') + '🎯迫击炮'
    if ((localPlayer.teleportTimer ?? 0) > 0) buffStr += (buffStr ? ' · ' : '') + `🌀传送${localPlayer.teleportTimer!.toFixed(2)}s`
    else if (localPlayer.warpCooldown > 0) buffStr += (buffStr ? ' · ' : '') + `🌀跃迁CD ${localPlayer.warpCooldown.toFixed(1)}s`
    setTextIfChanged(buffsEl, buffStr)
  }

  updateCaptureProgressCardUI()
  renderHudMinimap()

  const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0]
  setTextIfChanged(getEl('currentWeaponName'), mounted ? '🎯 迫击炮' : wep.shortName)
  setTextIfChanged(getEl('hudCurrentWeaponName'), wep.shortName)

  const secDef = SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag
  setTextIfChanged(getEl('hudSecondaryChipText'), `${secDef.icon} ${secDef.name}`)

  const curAmmo = Math.max(0, Math.ceil(localPlayer.ammo[localPlayer.weaponIndex] ?? 0))
  setTextIfChanged(getEl('currentAmmoText'), mounted ? '∞' : String(curAmmo))
  setTextIfChanged(getEl('reserveAmmoText'), mounted ? '' : String(localPlayer.reserveAmmo[localPlayer.weaponIndex] ?? 0))

  const ammoPipsEl = getEl('hudAmmoPips')
  if (ammoPipsEl) {
    if (wep.shellReload && wep.magSize <= 12) {
      const sig = `shell:${curAmmo}:${localPlayer.reloading ? 1 : 0}:${wep.magSize}`
      if (ammoPipsEl.getAttribute('data-sig') !== sig) {
        let html = ''
        for (let i = 0; i < wep.magSize; i++) {
          const filled = i < curAmmo
          const isLoadingThis = localPlayer.reloading && i === curAmmo
          html += `<span class="h-1.5 flex-1 rounded-xs ${
            filled
              ? 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.7)]'
              : isLoadingThis
                ? 'bg-cyan-400/80 animate-pulse'
                : 'bg-slate-800'
          }"></span>`
        }
        ammoPipsEl.setAttribute('data-sig', sig)
        ammoPipsEl.innerHTML = html
      }
    } else {
      const pct = Math.round(clamp((curAmmo / Math.max(1, wep.magSize)) * 100, 0, 100))
      const sig = `bar:${pct}`
      if (ammoPipsEl.getAttribute('data-sig') !== sig) {
        ammoPipsEl.setAttribute('data-sig', sig)
        ammoPipsEl.innerHTML = `<span class="block h-1.5 w-full rounded-full bg-slate-800 overflow-hidden"><span class="block h-full bg-gradient-to-r from-amber-400 to-cyan-300" style="width:${pct}%"></span></span>`
      }
    }
  }

  const gOverlay = getEl('grenadeCdOverlay')
  const gLabel = getEl('hudGrenadeLabel')
  const gTitle = getEl('hudSecondaryTitle')
  const touchGrenadeBtn = getEl('touchGrenadeBtn')
  setTextIfChanged(gTitle, secDef.name)

  let secStatusShort = `${secDef.icon} 就绪`
  if (gOverlay && gLabel) {
    if (localPlayer.secondary === 'doll') {
      setHeightIfChanged(gOverlay, localPlayer.dollCharges > 0 ? '0%' : '100%')
      secStatusShort = localPlayer.dollCharges > 0 ? `🎎 ×${localPlayer.dollCharges}` : '🎎 0'
      setTextIfChanged(gLabel, secStatusShort)
    } else if (localPlayer.secondary === 'frag') {
      const maxFrags = getPlayerFragMaxCharges(localPlayer.deathStreak ?? 0, world.config.fragMaxCharges)
      const need = localPlayer.fragCharges >= maxFrags
      if (need) {
        setHeightIfChanged(gOverlay, '0%')
        secStatusShort = `💣 ×${localPlayer.fragCharges}`
      } else {
        const pct = Math.round(Math.min(100, (localPlayer.fragRechargeTimer / world.config.fragRechargeSeconds) * 100))
        setHeightIfChanged(gOverlay, `${100 - pct}%`)
        secStatusShort = `💣 ${(world.config.fragRechargeSeconds - localPlayer.fragRechargeTimer).toFixed(1)}s`
      }
      setTextIfChanged(gLabel, secStatusShort)
    } else if (localPlayer.secondary === 'teleport' && (localPlayer.teleportTimer ?? 0) > 0) {
      const castTotal = Math.max(0.05, world.config.teleportCastTime ?? 0.35)
      const pct = Math.round(clamp((1 - localPlayer.teleportTimer! / castTotal) * 100, 0, 100))
      setHeightIfChanged(gOverlay, `${100 - pct}%`)
      secStatusShort = `🌀 ${pct}%`
      setTextIfChanged(gLabel, secStatusShort)
    } else {
      if (localPlayer.secondaryCooldown <= 0) {
        setHeightIfChanged(gOverlay, '0%')
        secStatusShort = `${secDef.icon} 就绪`
      } else {
        const pct = Math.round(clamp((localPlayer.secondaryCooldown / Math.max(0.1, secDef.cd)) * 100, 0, 100))
        setHeightIfChanged(gOverlay, `${pct}%`)
        secStatusShort = `${secDef.icon} ${localPlayer.secondaryCooldown.toFixed(1)}s`
      }
      setTextIfChanged(gLabel, secStatusShort)
    }
  }
  setTextIfChanged(touchGrenadeBtn, secStatusShort)

  const reloadWrap = getEl('reloadProgressWrap')
  const reloadBar = getEl('reloadProgressBar')
  const reloadLabel = getEl('reloadProgressLabel')
  const reloadPctEl = getEl('reloadProgressPct')
  const reloadDockBottomBar = getEl('reloadDockBottomBar')
  if (reloadWrap && reloadBar) {
    if (localPlayer.reloading) {
      reloadWrap.classList.remove('invisible', 'opacity-0', 'translate-y-1')
      reloadWrap.classList.add('opacity-100', 'translate-y-0')
      const wep2 = WEAPONS[localPlayer.weaponIndex]
      if (wep2.shellReload) {
        const perShell = wep2.reloadTime / Math.max(1, wep2.magSize)
        const pct = localPlayer.fireCooldown > 0
          ? 0
          : clamp(100 * (1 - localPlayer.reloadTimer / Math.max(1e-6, perShell)), 0, 100)
        setWidthIfChanged(reloadBar, `${Math.round(pct)}%`)
        if (reloadDockBottomBar) {
          setWidthIfChanged(reloadDockBottomBar, `${Math.round(clamp(((curAmmo + pct / 100) / Math.max(1, wep2.magSize)) * 100, 0, 100))}%`)
        }
        setTextIfChanged(reloadLabel, `装填 ${curAmmo}/${wep2.magSize}`)
        setTextIfChanged(reloadPctEl, localPlayer.fireCooldown > 0 ? '泵动' : `${Math.round(pct)}%`)
      } else {
        const pct = Math.round(clamp(100 * (1 - localPlayer.reloadTimer / Math.max(1e-6, wep2.reloadTime)), 0, 100))
        setWidthIfChanged(reloadBar, `${pct}%`)
        if (reloadDockBottomBar) setWidthIfChanged(reloadDockBottomBar, `${pct}%`)
        setTextIfChanged(reloadLabel, '换弹')
        setTextIfChanged(reloadPctEl, `${pct}%`)
      }
    } else {
      reloadWrap.classList.add('invisible', 'opacity-0', 'translate-y-1')
      reloadWrap.classList.remove('opacity-100', 'translate-y-0')
      if (reloadDockBottomBar) setWidthIfChanged(reloadDockBottomBar, '0%')
    }
  }

  const nearby = getNearbyInteractablePrompt(world, localPlayer, pendingLoadout.spawnPointId)
  const quickInteractBtn = getEl('hudQuickMortarBtn')
  const touchInteractBtn = getEl('touchInteractBtn')

  if (nearby && nearby.canInteract) {
    if (quickInteractBtn) {
      quickInteractBtn.classList.remove('hidden')
      setTextIfChanged(quickInteractBtn, nearby.shortLabel)
    }
    if (touchInteractBtn) {
      touchInteractBtn.classList.remove('hidden')
      setTextIfChanged(touchInteractBtn, nearby.shortLabel)
    }
  } else {
    quickInteractBtn?.classList.add('hidden')
    touchInteractBtn?.classList.add('hidden')
  }

  const banner = getEl('interactBanner')
  const bannerText = getEl('interactBannerText')
  if (!banner || !bannerText) return
  if (localPlayer.deployed && localPlayer.respawnTimer <= 0 && nearby) {
    banner.classList.remove('hidden')
    setTextIfChanged(bannerText, nearby.shortLabel)
  } else {
    banner.classList.add('hidden')
  }
}

export function updateScoreboardUI(): void {
  // 记分板已由右上角小地图代替
}

export function updateTeamCountUI(): void {
  const counts: Record<string, number> = { red: 0, blue: 0, ffa: 0 }
  for (const p of world.players) {
    if (counts[p.team] !== undefined) counts[p.team]++
  }
  for (const key of ['Red', 'Blue', 'Ffa']) {
    const el = getEl('teamCount' + key)
    setTextIfChanged(el, String(counts[key.toLowerCase()]))
  }
}
