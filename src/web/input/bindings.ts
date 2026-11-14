import { toggleFullscreen, isFullscreen, enterFullscreenAndLandscape, setupMobilePwaAndAutoLandscape, getElementLandscapeMetrics, getDeferredInstallPrompt, clearDeferredInstallPrompt, isMobileOrTouchDevice } from '../fullscreen.ts'
import { defaultMapData, carveTunnelInSolids, MAIN_DECK_TOP, BEDROCK_TOP, UNIFIED_EDGE_HIGHLIGHT } from '../../core/map.ts'
import type { MapSolid } from '../../core/map.ts'
import { AMMO_SPOTS, CENTER_RESPAWN_POINT } from '../../core/sim/world.ts'
import { getTerrainPattern } from '../textures.ts'
import { diagExport } from '../app/diag.ts'
// web/input/bindings.ts —— DOM 事件绑定（纯房间码 String + 房主下发参数 + 双队FFA许可配置 + 精简HUD）
import {
  canvas, world, localPlayer, bots, pendingLoadout, mode, uiState,
  keys, mouse, touchState, inputQueue, resizeCanvas, requestResizeCanvas,
} from '../app/context.ts'
import { showToast } from '../app/toast.ts'
import { warmupAudioCtx } from '../app/audio.ts'
import {
  updateHudWeaponButtons, updateSpawnPointButtonsUI, updateTeamCountUI,
  tryChangePrimaryWeapon, tryChangeSecondaryWeapon,
  toggleDebugHud, syncLobbyRoleUI, updateDebugHudVisibility, isHostAuthority, syncTeamButtonsUI,
  toggleFlagsHud, toggleSysBar, handleToggleFeatureFlagClick, handleResetAllFeatureFlags, cycleSelectedSpawnPoint, handleMinimapClick, selectSpawnPointById, syncFeatureFlagsUI,
} from '../app/hud.ts'
import type { FeatureFlags } from '../app/context.ts'
import {
  startHostRoom, joinHostRoom, leaveMultiplayerRoom, runDualWebRtcKcpSelfTest,
  updateNetStatusUI, netState, cleanRoomIdString, probeHostRoomParamsByString,
  broadcastHostRoomParams, sendClientLoadoutToHost,
} from '../app/net.ts'
import { syncParamsToUI, bindRangeParam, paramState } from '../app/params.ts'
import { setTouchLayerVisible } from './device.ts'
import { syncBotsCount } from '../game/bots.ts'
import { applyPendingLoadoutAndSpawn } from '../game/loadout.ts'
import { setPhysicsParams, resetPhysicsParams } from '../../core/sim/physics.ts'
import { isCapturePointSelectable } from '../../core/sim/world.ts'
import { WEAPONS, DEFAULT_CONFIG } from '../../core/weapons.ts'
import type { TeamId } from '../../core/types.ts'
import { wrapDeltaY, wrapDist } from '../../core/wrap.ts'

/** 尝试通过按 E 选中就近已占领的旗帜复活点（严格取当前同层最近据点，不再跨图乱跳） */
export function trySelectCapturedFlagSpawnByKey(): boolean {
  if (localPlayer.mountedTowerId || world.mortars.some(m => m.operatorId === localPlayer.id)) return false
  if (world.supplyCrates.some(cr => cr.active && cr.y > 400 && wrapDist(localPlayer.pos.x, localPlayer.pos.y, cr.x, cr.y) < 95)) return false

  const maxSelectDist = Math.max(150, world.config.captureRadius + 35)
  let bestSelectable: typeof world.capturePoints[0] | null = null
  let bestSelectableDist = Infinity
  let nearestAny: typeof world.capturePoints[0] | null = null
  let nearestAnyDist = Infinity

  for (const c of world.capturePoints) {
    if (c.y <= 400) continue
    if (Math.abs(wrapDeltaY(localPlayer.pos.y, c.y)) > 115) continue
    const d = wrapDist(localPlayer.pos.x, localPlayer.pos.y, c.x, c.y)
    if (d < maxSelectDist) {
      if (d < nearestAnyDist) {
        nearestAnyDist = d
        nearestAny = c
      }
      if (isCapturePointSelectable(c, localPlayer.team) && d < bestSelectableDist) {
        bestSelectableDist = d
        bestSelectable = c
      }
    }
  }
  if (!bestSelectable) {
    if (nearestAny) {
      showToast(`⚠️ 需先占领【${nearestAny.name}】(${Math.round(nearestAny.progress)}%) 才能按 E 选为复活点`)
    }
    return false
  }
  pendingLoadout.spawnPointId = bestSelectable.id
  localPlayer.selectedSpawnId = bestSelectable.id
  updateSpawnPointButtonsUI()
  if (netState.role === 'client') sendClientLoadoutToHost(false)
  showToast(`🚩 已选中【${bestSelectable.name}】作为复活点`)
  return true
}

export function bindAllEvents(): void {
  // resize / ResizeObserver / visualViewport 都可能因地址栏收放、工具栏折叠、缩放而连续触发；
  // 统一走去抖版本，避免短时间内反复重建 canvas 后备缓冲（周期性卡顿来源之一）。
  const onViewportChange = (): void => {
    requestResizeCanvas()
    renderIge()
  }
  window.addEventListener('resize', onViewportChange)
  if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
    const ro = new ResizeObserver(onViewportChange)
    if (document.documentElement instanceof Element) ro.observe(document.documentElement)
  }
  // visualViewport 能捕获移动端地址栏收放引起的视口高度变化（innerHeight 抖动）
  if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportChange)
  }
  setupMobilePwaAndAutoLandscape(() => {
    requestResizeCanvas()
    renderIge()
  })
  resizeCanvas()

  window.addEventListener('keydown', (e) => {
    warmupAudioCtx()
    const active = document.activeElement
    if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return
    keys[e.code] = true
    if (e.code === 'KeyR') inputQueue.reload = true
    else if (e.code === 'KeyG' || e.code === 'KeyQ') inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
    else if (e.code === 'KeyE') {
      inputQueue.interact = true
      trySelectCapturedFlagSpawnByKey()
    }
    else if (e.code === 'Backquote' || e.code === 'F3') {
      e.preventDefault()
      toggleDebugHud()
    }
    else if (e.code === 'Digit1') tryChangePrimaryWeapon(0)
    else if (e.code === 'Digit2') tryChangePrimaryWeapon(8)
    else if (e.code === 'Digit3') tryChangePrimaryWeapon(1)
    else if (e.code === 'Digit4') tryChangePrimaryWeapon(2)
    else if (e.code === 'Digit5') tryChangePrimaryWeapon(7)
    else if (e.code === 'Digit6') tryChangePrimaryWeapon(3)
  })
  window.addEventListener('keydown', (e) => { if (e.code === 'Space') igeSpace = true })
  window.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Space') igeSpace = false })

  canvas?.addEventListener('mousemove', (e) => {
    const m = getElementLandscapeMetrics(canvas, e.clientX, e.clientY)
    mouse.x = m.relX
    mouse.y = m.relY
    if (!touchState.aimActive) touchState.aimUsed = false
  })
  canvas?.addEventListener('mousedown', (e) => {
    warmupAudioCtx()
    if (!touchState.aimActive) touchState.aimUsed = false
    if (e.button === 0) mouse.down = true
    else if (e.button === 2) inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  canvas?.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false })
  canvas?.addEventListener('contextmenu', (e) => e.preventDefault())

  document.getElementById('lobbyTabHostBtn')?.addEventListener('click', () => {
    syncLobbyRoleUI('host')
  })
  document.getElementById('lobbyTabClientBtn')?.addEventListener('click', () => {
    syncLobbyRoleUI('client')
  })

  document.getElementById('toggleDebugHudBtn')?.addEventListener('click', () => {
    toggleDebugHud()
  })
  document.getElementById('closeDebugHudBtn')?.addEventListener('click', () => {
    uiState.debugHudOpen = false
    updateDebugHudVisibility()
  })
  document.getElementById('toggleSysBarBtn')?.addEventListener('click', () => {
    toggleSysBar()
  })
  document.getElementById('toggleFlagsHudBtn')?.addEventListener('click', () => {
    toggleFlagsHud()
  })
  document.getElementById('closeFlagsHudBtn')?.addEventListener('click', () => {
    uiState.flagsHudOpen = false
    syncFeatureFlagsUI()
  })
  document.getElementById('resetFeatureFlagsBtn')?.addEventListener('click', () => {
    handleResetAllFeatureFlags()
  })
  document.querySelectorAll('.feature-flag-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-flag') as keyof FeatureFlags | null
      if (k) handleToggleFeatureFlagClick(k)
    })
  })
  document.getElementById('hudCurrentSpawnBtn')?.addEventListener('click', () => {
    cycleSelectedSpawnPoint()
  })
  document.getElementById('hudMinimapCanvas')?.addEventListener('click', (e) => {
    const me = e as MouseEvent
    handleMinimapClick(me.clientX, me.clientY, 'hudMinimapCanvas')
  })
  document.getElementById('deathMinimapCanvas')?.addEventListener('click', (e) => {
    const me = e as MouseEvent
    handleMinimapClick(me.clientX, me.clientY, 'deathMinimapCanvas')
  })
  document.getElementById('deathSpawnBaseBtn')?.addEventListener('click', () => {
    selectSpawnPointById('base')
  })

  document.querySelectorAll('.lobby-wep-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangePrimaryWeapon(Number(btn.getAttribute('data-wep') || 0))))
  document.querySelectorAll('.lobby-sec-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangeSecondaryWeapon(btn.getAttribute('data-sec') || 'frag')))
  document.querySelectorAll('.death-wep-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      tryChangePrimaryWeapon(Number(btn.getAttribute('data-wep') || 0))
      updateHudWeaponButtons()
    }))
  document.querySelectorAll('.death-sec-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      tryChangeSecondaryWeapon(btn.getAttribute('data-sec') || 'frag')
      updateHudWeaponButtons()
    }))

  document.querySelectorAll('.spawn-select-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const spId = btn.getAttribute('data-spawn') || 'base'
      if (spId !== 'base') {
        const cp = world.capturePoints.find(c => c.id === spId)
        if (!isCapturePointSelectable(cp, localPlayer.team)) {
          showToast('⚠️ 占领后可选')
          return
        }
      }
      pendingLoadout.spawnPointId = spId
      localPlayer.selectedSpawnId = spId
      updateSpawnPointButtonsUI()
      if (netState.role === 'client') sendClientLoadoutToHost(false)
    })
  })

  document.querySelectorAll('.ffa-allow-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!isHostAuthority()) return
      mode.allowFfaInTeams = btn.getAttribute('data-allow-ffa') === '1'
      syncTeamButtonsUI()
      broadcastHostRoomParams()
    })
  })

  document.querySelectorAll('.bot-count-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!isHostAuthority()) return
      const cnt = Math.max(0, Math.min(32, Number(btn.getAttribute('data-bots') || 0)))
      syncBotsCount(cnt)
      broadcastHostRoomParams()
      updateNetStatusUI()
    })
  })

  const botCountInput = document.getElementById('botCountInput') as HTMLInputElement | null
  if (botCountInput) {
    const applyCustomBotCount = () => {
      if (!isHostAuthority()) return
      const raw = Number(botCountInput.value)
      const cnt = Number.isFinite(raw) ? Math.max(0, Math.min(32, Math.floor(raw))) : 0
      botCountInput.value = String(cnt)
      syncBotsCount(cnt)
      broadcastHostRoomParams()
      updateNetStatusUI()
    }
    botCountInput.addEventListener('change', applyCustomBotCount)
    botCountInput.addEventListener('input', applyCustomBotCount)
  }

  document.getElementById('peerHostBtn')?.addEventListener('click', () => {
    startHostRoom()
    syncLobbyRoleUI('host')
  })
  document.getElementById('peerCopyIdBtn')?.addEventListener('click', () => {
    const inp = document.getElementById('peerLocalIdInput') as HTMLInputElement | null
    if (!netState.roomId) startHostRoom()
    const val = cleanRoomIdString(inp?.value || netState.roomId)
    if (inp) inp.value = val
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).catch(() => {})
      } else if (inp) {
        inp.select()
        document.execCommand('copy')
      }
    } catch {
      if (inp) {
        inp.select()
        try { document.execCommand('copy') } catch { /* ignore */ }
      }
    }
    showToast(`📋 已复制房间码：${val}`)
  })

  const remoteInput = document.getElementById('peerRemoteIdInput') as HTMLInputElement | null
  remoteInput?.addEventListener('input', () => {
    const cleaned = cleanRoomIdString(remoteInput.value)
    probeHostRoomParamsByString(cleaned)
  })
  document.getElementById('peerJoinBtn')?.addEventListener('click', () => {
    const val = cleanRoomIdString(remoteInput?.value || '')
    void joinHostRoom(val)
  })
  document.getElementById('peerLeaveBtn')?.addEventListener('click', () => {
    leaveMultiplayerRoom()
    syncLobbyRoleUI('host')
  })
  document.getElementById('peerLoopbackTestBtn')?.addEventListener('click', () => {
    if (!isHostAuthority()) return
    void runDualWebRtcKcpSelfTest()
  })

  // ── 诊断日志：导出按钮 + Ctrl/Cmd+Shift+L 快捷键 ──
  const dumpDiag = (): void => {
    try {
      diagExport()
      showToast('📥 诊断日志已导出（json + txt）')
    } catch {
      showToast('⚠️ 导出失败，请开控制台用 __diag.dump()')
    }
  }
  document.getElementById('diagDumpBtn')?.addEventListener('click', dumpDiag)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'KeyL' || e.key === 'L')) {
      e.preventDefault()
      dumpDiag()
    }
  })

  document.querySelectorAll('.param-wep-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      paramState.weaponIdx = Number(btn.getAttribute('data-pwep') || 0)
      syncParamsToUI()
    })
  })

  const fsBtn = document.getElementById('fullscreenBtn')
  const fsBtnText = document.getElementById('fullscreenBtnText')
  const updateFsLabel = () => {
    if (fsBtnText) fsBtnText.textContent = isFullscreen() ? '退出' : '全屏'
  }
  fsBtn?.addEventListener('click', () => {
    toggleFullscreen()
    resizeCanvas()
    updateFsLabel()
  })
  document.addEventListener('fullscreenchange', updateFsLabel)

  const handleInstallOrFullscreenApp = async (): Promise<void> => {
    enterFullscreenAndLandscape()
    resizeCanvas()
    updateFsLabel()
    const promptEv = getDeferredInstallPrompt()
    if (promptEv) {
      try {
        await promptEv.prompt()
        await promptEv.userChoice
      } catch { /* ignore */ }
      clearDeferredInstallPrompt()
      showToast('📲 已触发应用安装并进入全屏横屏模式')
    } else {
      showToast('📲 已开启全屏横屏！手机端可通过浏览器菜单「添加到主屏幕 / 安装应用」安装到桌面')
    }
  }
  document.getElementById('pwaInstallBtn')?.addEventListener('click', () => {
    void handleInstallOrFullscreenApp()
  })
  document.getElementById('lobbyInstallAppBtn')?.addEventListener('click', () => {
    void handleInstallOrFullscreenApp()
  })
  document.getElementById('hudReloadBtn')?.addEventListener('click', () => { inputQueue.reload = true })
  document.getElementById('hudGrenadeBtn')?.addEventListener('click', () => {
    inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  document.getElementById('hudQuickMortarBtn')?.addEventListener('click', () => {
    inputQueue.interact = true
    trySelectCapturedFlagSpawnByKey()
  })

  const igeModal = document.getElementById('inGameEditorModal')
  const igeCanvas = document.getElementById('igeCanvas') as HTMLCanvasElement | null
  let igeSolids: MapSolid[] = defaultMapData().solids.map(s => ({ ...s }))
  const igeHistory: string[] = []
  let igeTool: 'draw' | 'select' | 'carve' | 'erase' = 'draw'
  let igeSelected = -1
  const igeCam = { x: 6600, y: 1550, zoom: 0.09 }
  let igeDragStart: { x: number; y: number } | null = null
  let igeDragCur: { x: number; y: number } | null = null
  let igePanning = false
  let igePanLast = { x: 0, y: 0 }
  let igeSpace = false

  function renderIge(): void {
    if (!igeCanvas || !igeModal || igeModal.classList.contains('hidden')) return
    const c = igeCanvas.getContext('2d')
    if (!c) return
    if (igeCanvas.width !== igeCanvas.clientWidth || igeCanvas.height !== igeCanvas.clientHeight) {
      igeCanvas.width = igeCanvas.clientWidth || 1100
      igeCanvas.height = igeCanvas.clientHeight || 640
    }
    const W = igeCanvas.width, H = igeCanvas.height
    c.fillStyle = '#040812'
    c.fillRect(0, 0, W, H)
    const sx = (wx: number) => W / 2 + (wx - igeCam.x) * igeCam.zoom
    const sy = (wy: number) => H / 2 + (wy - igeCam.y) * igeCam.zoom
    c.fillStyle = 'rgba(7, 11, 20, 0.7)'
    c.fillRect(sx(0), sy(MAIN_DECK_TOP), 13200 * igeCam.zoom, (BEDROCK_TOP - MAIN_DECK_TOP) * igeCam.zoom)
    c.strokeStyle = 'rgba(56,189,248,0.45)'
    c.setLineDash([6, 4])
    c.beginPath(); c.moveTo(sx(0), sy(MAIN_DECK_TOP)); c.lineTo(sx(13200), sy(MAIN_DECK_TOP)); c.stroke()
    c.setLineDash([])
    const pat = getTerrainPattern(c, 'block')
    for (let i = 0; i < igeSolids.length; i++) {
      const s = igeSolids[i]
      c.fillStyle = pat ?? '#162032'
      c.fillRect(sx(s.x), sy(s.y), s.w * igeCam.zoom, s.h * igeCam.zoom)
      c.strokeStyle = i === igeSelected ? '#fbbf24' : UNIFIED_EDGE_HIGHLIGHT
      c.lineWidth = i === igeSelected ? 2.5 : 1.5
      c.strokeRect(sx(s.x), sy(s.y), s.w * igeCam.zoom, s.h * igeCam.zoom)
    }
    for (const am of AMMO_SPOTS) {
      c.fillStyle = '#22c55e'
      c.fillRect(sx(am.x) - 4, sy(am.y) - 4, 8, 8)
    }
    c.fillStyle = '#10b981'
    c.beginPath(); c.arc(sx(CENTER_RESPAWN_POINT.x), sy(CENTER_RESPAWN_POINT.y), 6, 0, Math.PI * 2); c.fill()
    if (igeDragStart && igeDragCur) {
      const x = Math.min(igeDragStart.x, igeDragCur.x)
      const y = Math.min(igeDragStart.y, igeDragCur.y)
      const w = Math.max(40, Math.abs(igeDragCur.x - igeDragStart.x))
      const h = Math.max(40, Math.abs(igeDragCur.y - igeDragStart.y))
      c.fillStyle = igeTool === 'carve' ? 'rgba(244,63,94,0.28)' : 'rgba(56,189,248,0.25)'
      c.strokeStyle = igeTool === 'carve' ? '#fb7185' : UNIFIED_EDGE_HIGHLIGHT
      c.fillRect(sx(x), sy(y), w * igeCam.zoom, h * igeCam.zoom)
      c.strokeRect(sx(x), sy(y), w * igeCam.zoom, h * igeCam.zoom)
    }
    const st = document.getElementById('igeStatus')
    if (st) st.textContent = `${igeSolids.length} 块`
  }

  document.getElementById('openEditorBtn')?.addEventListener('click', () => {
    if (!isHostAuthority()) return
    if (igeModal) {
      igeModal.classList.remove('hidden')
      igeModal.classList.add('flex')
      setTimeout(renderIge, 20)
    } else {
      window.open('./editor.html', '_blank')
    }
  })
  document.getElementById('igeCloseBtn')?.addEventListener('click', () => {
    igeModal?.classList.add('hidden')
    igeModal?.classList.remove('flex')
  })
  document.querySelectorAll('.ige-tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      igeTool = (btn.getAttribute('data-ige-tool') || 'draw') as typeof igeTool
      document.querySelectorAll('.ige-tool-btn').forEach(b => {
        const active = b.getAttribute('data-ige-tool') === igeTool
        b.className = 'ige-tool-btn px-2.5 py-1 rounded font-bold border ' + (active ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-800 text-slate-200 border-slate-700')
      })
      renderIge()
    })
  })
  const pushIgeHist = () => { igeHistory.push(JSON.stringify(igeSolids)); if (igeHistory.length > 40) igeHistory.shift() }
  document.getElementById('igeUndo')?.addEventListener('click', () => {
    const prev = igeHistory.pop()
    if (prev) { igeSolids = JSON.parse(prev); renderIge() }
  })
  document.getElementById('igeReset')?.addEventListener('click', () => {
    pushIgeHist()
    igeSolids = defaultMapData().solids.map(s => ({ ...s }))
    renderIge()
  })
  document.getElementById('igeStampTunnel')?.addEventListener('click', () => {
    pushIgeHist()
    const cx = Math.round((igeCam.x - 400) / 20) * 20
    const cy = Math.max(MAIN_DECK_TOP + 40, Math.round((igeCam.y - 100) / 20) * 20)
    igeSolids.push({ x: cx, y: cy, w: 800, h: 60, kind: 'block' }, { x: cx, y: cy + 200, w: 800, h: 60, kind: 'block' })
    renderIge()
  })
  document.getElementById('igeStampShaft')?.addEventListener('click', () => {
    pushIgeHist()
    const cx = Math.round((igeCam.x - 140) / 20) * 20
    const cy = Math.max(MAIN_DECK_TOP + 40, Math.round((igeCam.y - 200) / 20) * 20)
    igeSolids.push({ x: cx, y: cy, w: 60, h: 400, kind: 'block' }, { x: cx + 220, y: cy, w: 60, h: 400, kind: 'block' })
    renderIge()
  })
  document.getElementById('igeStampIsland')?.addEventListener('click', () => {
    pushIgeHist()
    igeSolids.push({ x: Math.round((igeCam.x - 320) / 20) * 20, y: Math.min(1400, Math.round((igeCam.y - 110) / 20) * 20), w: 640, h: 220, kind: 'block' })
    renderIge()
  })
  document.getElementById('igeSymmetrize')?.addEventListener('click', () => {
    pushIgeHist()
    const mid = 6600
    const kept: MapSolid[] = []
    const mirrored: MapSolid[] = []
    for (const s of igeSolids) {
      if (s.x <= mid && s.x + s.w >= mid) kept.push({ ...s })
      else if (s.x + s.w <= mid) {
        kept.push({ ...s })
        mirrored.push({ x: 13200 - s.x - s.w, y: s.y, w: s.w, h: s.h, kind: s.kind })
      }
    }
    igeSolids = [...kept, ...mirrored]
    renderIge()
  })
  document.getElementById('igeApplyBtn')?.addEventListener('click', () => {
    world.terrain.build(igeSolids)
    localStorage.setItem('pvp-custom-map', JSON.stringify({ name: '自定义地图', solids: igeSolids }))
    igeModal?.classList.add('hidden')
    igeModal?.classList.remove('flex')
    showToast('✅ 已应用地图')
  })
  document.getElementById('igeExportPng')?.addEventListener('click', () => {
    const off = document.createElement('canvas')
    off.width = 2640; off.height = 880
    const c = off.getContext('2d')!
    c.fillStyle = '#040812'; c.fillRect(0, 0, off.width, off.height)
    c.save(); c.scale(off.width / 13200, off.height / 4400)
    const pat = getTerrainPattern(c, 'block')
    c.fillStyle = pat ?? '#162032'
    c.fillRect(0, BEDROCK_TOP, 13200, 4400 - BEDROCK_TOP)
    for (const s of igeSolids) {
      c.fillStyle = pat ?? '#162032'
      c.fillRect(s.x, s.y, s.w, s.h)
      c.strokeStyle = UNIFIED_EDGE_HIGHLIGHT; c.lineWidth = 5
      c.strokeRect(s.x, s.y, s.w, s.h)
    }
    c.restore()
    const a = document.createElement('a')
    a.href = off.toDataURL('image/png')
    a.download = 'skyblast-2d-panorama.png'
    a.click()
  })
  igeCanvas?.addEventListener('contextmenu', e => e.preventDefault())
  igeCanvas?.addEventListener('mousedown', e => {
    if (!igeCanvas) return
    const rect = igeCanvas.getBoundingClientRect()
    const wx = Math.round((igeCam.x + (e.clientX - rect.left - igeCanvas.width / 2) / igeCam.zoom) / 20) * 20
    const wy = Math.round((igeCam.y + (e.clientY - rect.top - igeCanvas.height / 2) / igeCam.zoom) / 20) * 20
    if (e.button === 1 || (e.button === 0 && igeSpace)) {
      igePanning = true; igePanLast = { x: e.clientX, y: e.clientY }; return
    }
    if (e.button === 2 || igeTool === 'erase') {
      pushIgeHist()
      igeSolids = igeSolids.filter(s => !(wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h))
      renderIge(); return
    }
    if (igeTool === 'select') {
      igeSelected = igeSolids.findIndex(s => wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h)
      renderIge(); return
    }
    igeDragStart = { x: wx, y: wy }; igeDragCur = { x: wx, y: wy }
    renderIge()
  })
  igeCanvas?.addEventListener('mousemove', e => {
    if (!igeCanvas) return
    if (igePanning) {
      igeCam.x -= (e.clientX - igePanLast.x) / igeCam.zoom
      igeCam.y -= (e.clientY - igePanLast.y) / igeCam.zoom
      igePanLast = { x: e.clientX, y: e.clientY }
      renderIge(); return
    }
    if (!igeDragStart) return
    const rect = igeCanvas.getBoundingClientRect()
    const wx = Math.round((igeCam.x + (e.clientX - rect.left - igeCanvas.width / 2) / igeCam.zoom) / 20) * 20
    const wy = Math.round((igeCam.y + (e.clientY - rect.top - igeCanvas.height / 2) / igeCam.zoom) / 20) * 20
    igeDragCur = { x: wx, y: wy }
    renderIge()
  })
  window.addEventListener('mouseup', () => {
    igePanning = false
    if (igeDragStart && igeDragCur) {
      pushIgeHist()
      const x = Math.min(igeDragStart.x, igeDragCur.x)
      const y = Math.min(igeDragStart.y, igeDragCur.y)
      const w = Math.max(40, Math.abs(igeDragCur.x - igeDragStart.x))
      const h = Math.max(40, Math.abs(igeDragCur.y - igeDragStart.y))
      if (igeTool === 'carve') igeSolids = carveTunnelInSolids(igeSolids, { x, y, w, h }, 20)
      else igeSolids.push({ x, y, w, h, kind: 'block' })
      igeDragStart = null; igeDragCur = null
      renderIge()
    }
  })
  igeCanvas?.addEventListener('wheel', e => {
    e.preventDefault()
    igeCam.zoom = Math.max(0.05, Math.min(0.8, igeCam.zoom * Math.exp(-e.deltaY * 0.0012)))
    renderIge()
  }, { passive: false })
  document.getElementById('openAdminBtn')?.addEventListener('click', () => {
    if (!isHostAuthority()) return
    const pm = document.getElementById('paramsModal')
    if (pm) {
      pm.classList.remove('hidden')
      pm.classList.add('flex')
      syncParamsToUI()
      showToast('📊 已打开参数与武器数值调校面板')
    }
  })
  document.getElementById('interactBannerBtn')?.addEventListener('click', () => {
    if (!localPlayer.deployed || localPlayer.respawnTimer > 0) {
      const lobby = document.getElementById('lobbyModal')
      lobby?.classList.remove('hidden')
      lobby?.classList.add('flex')
      updateSpawnPointButtonsUI()
      syncLobbyRoleUI()
    } else {
      inputQueue.interact = true
      trySelectCapturedFlagSpawnByKey()
    }
  })

  function applyMode(nextMode: 'ffa' | '2teams'): void {
    if (!isHostAuthority()) return
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      showToast('⚠️ 需在待机或阵亡时切换')
      return
    }
    mode.current = nextMode
    document.querySelectorAll('.mode-btn').forEach((b) => {
      const sel = b.getAttribute('data-mode') === nextMode
      b.className = 'mode-btn px-3 py-2 rounded-xl text-center transition border ' +
        (sel ? 'border-2 border-emerald-400 bg-emerald-500/20' : 'border border-slate-700 bg-slate-950/60 hover:border-slate-500')
    })
    if (nextMode === 'ffa') {
      localPlayer.team = 'ffa'
    } else if (!mode.allowFfaInTeams && localPlayer.team === 'ffa') {
      localPlayer.team = 'red'
    } else if (localPlayer.team !== 'blue' && localPlayer.team !== 'ffa') {
      localPlayer.team = 'red'
    }
    syncBotsCount(bots.length)
    syncTeamButtonsUI()
    updateTeamCountUI()
    updateSpawnPointButtonsUI()
    broadcastHostRoomParams()
  }
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => applyMode((b.getAttribute('data-mode') || 'ffa') as 'ffa' | '2teams'))
  })

  document.querySelectorAll('.team-select-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if ((btn as HTMLButtonElement).disabled) return
      const chosen = (btn.getAttribute('data-team') || 'red') as TeamId
      if (mode.current === '2teams' && chosen === 'ffa' && !mode.allowFfaInTeams) {
        showToast('🚫 房主已禁止 FFA 身份')
        return
      }
      localPlayer.team = chosen
      if (isHostAuthority()) {
        syncBotsCount(bots.length)
      } else if (netState.role === 'client') {
        sendClientLoadoutToHost(false)
      }
      syncTeamButtonsUI()
      updateTeamCountUI()
      updateSpawnPointButtonsUI()
    })
  })

  document.getElementById('playerNameInput')?.addEventListener('input', (e) => {
    localPlayer.name = (e.target as HTMLInputElement).value.trim() || 'SkyHunter'
    if (netState.role === 'client') sendClientLoadoutToHost(false)
  })

  const lobbyModal = document.getElementById('lobbyModal')
  document.getElementById('openLobbyBtn')?.addEventListener('click', () => {
    lobbyModal?.classList.remove('hidden')
    lobbyModal?.classList.add('flex')
    updateSpawnPointButtonsUI()
    syncLobbyRoleUI()
  })

  document.getElementById('startBattleBtn')?.addEventListener('click', () => {
    warmupAudioCtx()
    if (isMobileOrTouchDevice() || touchState.enabled) {
      enterFullscreenAndLandscape()
      resizeCanvas()
      updateFsLabel()
    }
    if (uiState.lobbyRole === 'client' && netState.role !== 'client') {
      const raw = cleanRoomIdString((document.getElementById('peerRemoteIdInput') as HTMLInputElement | null)?.value || '')
      if (raw) {
        void joinHostRoom(raw)
      }
    }
    if (!localPlayer.deployed || localPlayer.respawnTimer > 0) {
      applyPendingLoadoutAndSpawn()
    } else if (netState.role === 'client') {
      sendClientLoadoutToHost(true)
    }
    lobbyModal?.classList.add('hidden')
    lobbyModal?.classList.remove('flex')
  })

  document.getElementById('inputDeviceDetectBadge')?.addEventListener('click', () => setTouchLayerVisible(!touchState.enabled, false))
  document.getElementById('toggleTouchBtn')?.addEventListener('click', () => setTouchLayerVisible(!touchState.enabled, false))
  document.getElementById('lobbyCtrlKbmBtn')?.addEventListener('click', () => setTouchLayerVisible(false, false))
  document.getElementById('lobbyCtrlGamepadBtn')?.addEventListener('click', () => setTouchLayerVisible(true, false))
  document.getElementById('resetTerrainBtn')?.addEventListener('click', () => {
    if (!isHostAuthority()) return
    world.resetMatch()
    pendingLoadout.spawnPointId = 'base'
    localPlayer.selectedSpawnId = 'base'
    updateSpawnPointButtonsUI()
    showToast('✅ 已重置地形')
  })

  const paramsModal = document.getElementById('paramsModal')
  const openParams = (): void => {
    if (!isHostAuthority()) return
    paramsModal?.classList.remove('hidden')
    paramsModal?.classList.add('flex')
    syncParamsToUI()
  }
  const closeParams = (): void => {
    paramsModal?.classList.add('hidden')
    paramsModal?.classList.remove('flex')
    broadcastHostRoomParams()
  }
  document.getElementById('openParamsBtn')?.addEventListener('click', openParams)
  document.getElementById('lobbyOpenParamsBtn')?.addEventListener('click', openParams)
  document.getElementById('closeParamsBtn')?.addEventListener('click', closeParams)
  document.getElementById('resetParamsBtn')?.addEventListener('click', () => {
    if (!isHostAuthority()) return
    resetPhysicsParams()
    world.config = { ...DEFAULT_CONFIG }
    syncParamsToUI()
    broadcastHostRoomParams()
    showToast('✅ 已恢复默认')
  })

  bindRangeParam('paramGravity', 'valGravity', '', (v) => { setPhysicsParams({ gravity: v }); broadcastHostRoomParams() })
  bindRangeParam('paramMoveSpeed', 'valMoveSpeed', '', (v) => { setPhysicsParams({ moveSpeed: v }); broadcastHostRoomParams() })
  bindRangeParam('paramJetpackAccel', 'valJetpackAccel', '', (v) => { setPhysicsParams({ jetpackAccel: v }); broadcastHostRoomParams() })
  bindRangeParam('paramJetpackMaxUp', 'valJetpackMaxUp', '', (v) => { setPhysicsParams({ jetpackMaxUp: v }); broadcastHostRoomParams() })
  bindRangeParam('paramMaxHp', 'valMaxHp', '', (v) => {
    world.config.maxHp = v
    for (const p of world.players) { p.maxHp = v; if (p.hp > v) p.hp = v }
    broadcastHostRoomParams()
  })
  bindRangeParam('paramHeadRadius', 'valHeadRadius', '', (v) => { world.config.headRadius = v })
  bindRangeParam('paramWepDamage', 'valWepDamage', '', (v) => { WEAPONS[paramState.weaponIdx].damage = v })
  bindRangeParam('paramWepHeadshot', 'valWepHeadshot', 'x', (v) => { WEAPONS[paramState.weaponIdx].headshotMult = v })
  bindRangeParam('paramWepSpeed', 'valWepSpeed', '', (v) => { WEAPONS[paramState.weaponIdx].speed = v })
  // 散布与射击间隔：用户明确要求能在面板里直接调
  bindRangeParam('paramWepSpread', 'valWepSpread', '', (v) => { WEAPONS[paramState.weaponIdx].spread = v })
  bindRangeParam('paramWepFireDelay', 'valWepFireDelay', 's', (v) => { WEAPONS[paramState.weaponIdx].fireDelay = v })
  bindRangeParam('paramWepMag', 'valWepMag', '', (v) => { WEAPONS[paramState.weaponIdx].magSize = v })
  bindRangeParam('paramWepReload', 'valWepReload', 's', (v) => { WEAPONS[paramState.weaponIdx].reloadTime = v })
  // 逐武器可调：移动倍率（moveSpeedMult）与飞行容量倍率（fuelMult）。
  // 二者都是 WeaponDef 字段，每把武器各自持有，用于区分「重武器走得慢 / 耗气快」。
  bindRangeParam('paramWepMove', 'valWepMove', 'x', (v) => { WEAPONS[paramState.weaponIdx].moveSpeedMult = v })
  bindRangeParam('paramWepFuel', 'valWepFuel', 'x', (v) => { WEAPONS[paramState.weaponIdx].fuelMult = v })
  bindRangeParam('paramGrenadeDmg', 'valGrenadeDmg', '', (v) => { world.config.grenadeDamage = v })
  bindRangeParam('paramGrenadeRadius', 'valGrenadeRadius', '', (v) => { world.config.grenadeRadius = v })
  bindRangeParam('paramMineDmg', 'valMineDmg', '', (v) => { world.config.mineDamage = v })
  bindRangeParam('paramMineRadius', 'valMineRadius', '', (v) => { world.config.mineTriggerRadius = v })
  bindRangeParam('paramMortarDmg', 'valMortarDmg', '', (v) => { world.config.mortarDamage = v })
  bindRangeParam('paramMortarRadius', 'valMortarRadius', '', (v) => { world.config.mortarRadius = v })
  bindRangeParam('paramRespawnDelay', 'valRespawnDelay', 's', (v) => { world.config.respawnDelay = v; broadcastHostRoomParams() })
  bindRangeParam('paramDollMax', 'valDollMax', '', (v) => { world.config.dollMaxCharges = v })

  function bindJoystick(zoneEl: HTMLElement | null, stickEl: HTMLElement | null, isAim: boolean): void {
    if (!zoneEl || !stickEl) return
    const maxDist = 52
    const ascendHintEl = document.getElementById('touchMoveAscendBadge')
    const aimFireHintEl = document.getElementById('touchAimFireBadge')

    const handleMove = (clientX: number, clientY: number): void => {
      const m = getElementLandscapeMetrics(zoneEl, clientX, clientY)
      let dx = m.dxFromCenter
      let dy = m.dyFromCenter
      const dist = Math.hypot(dx, dy)
      if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist }
      stickEl.style.transform = `translate(${dx}px, ${dy}px)`
      const nx = dx / maxDist
      const ny = dy / maxDist
      if (isAim) {
        touchState.aimX = nx
        touchState.aimY = ny
        const firing = Math.hypot(nx, ny) > 0.42
        stickEl.className = firing
          ? 'w-14 h-14 rounded-full bg-rose-500/85 border-2 border-amber-200 shadow-[0_0_18px_rgba(244,63,94,0.85)] pointer-events-none absolute top-1/2 left-1/2 -ml-7 -mt-7 transition-transform duration-50'
          : 'w-14 h-14 rounded-full bg-rose-500/55 border-2 border-white/80 shadow-lg pointer-events-none absolute top-1/2 left-1/2 -ml-7 -mt-7 transition-transform duration-50'
        if (aimFireHintEl) aimFireHintEl.textContent = firing ? '🔥 射击' : '🎯 瞄准'
      } else {
        touchState.moveX = nx
        touchState.moveY = ny
        const ascending = ny < -0.26
        stickEl.className = ascending
          ? 'w-14 h-14 rounded-full bg-cyan-300/85 border-2 border-white shadow-[0_0_20px_rgba(34,211,238,0.9)] pointer-events-none absolute top-1/2 left-1/2 -ml-7 -mt-7 transition-transform duration-50'
          : 'w-14 h-14 rounded-full bg-sky-400/60 border-2 border-white/80 shadow-lg pointer-events-none absolute top-1/2 left-1/2 -ml-7 -mt-7 transition-transform duration-50'
        if (ascendHintEl) {
          ascendHintEl.textContent = ascending ? '🚀 升空' : '▲ 升空'
          ascendHintEl.className = ascending
            ? 'text-[10px] font-extrabold text-cyan-200 bg-cyan-500/30 px-2 py-0.5 rounded-full border border-cyan-300/60'
            : 'text-[10px] font-bold text-sky-200/75'
        }
      }
    }
    zoneEl.addEventListener('touchstart', (e) => {
      if (!touchState.enabled) return
      e.preventDefault()
      warmupAudioCtx()
      const t = e.changedTouches[0]
      if (isAim) { touchState.aimActive = true; touchState.aimUsed = true; touchState.aimId = t.identifier }
      else { touchState.moveActive = true; touchState.moveId = t.identifier }
      handleMove(t.clientX, t.clientY)
    }, { passive: false })
    zoneEl.addEventListener('touchmove', (e) => {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        if ((isAim && t.identifier === touchState.aimId) || (!isAim && t.identifier === touchState.moveId)) {
          handleMove(t.clientX, t.clientY)
        }
      }
    }, { passive: false })
    const endTouch = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (isAim && t.identifier === touchState.aimId) {
          touchState.aimActive = false; touchState.aimX = 0; touchState.aimY = 0
          stickEl.style.transform = 'translate(0px, 0px)'
          stickEl.className = 'w-14 h-14 rounded-full bg-rose-500/60 border-2 border-white/80 shadow-lg pointer-events-none absolute top-1/2 left-1/2 -ml-7 -mt-7 transition-transform duration-75'
          if (aimFireHintEl) aimFireHintEl.textContent = '瞄准 / 外推开火'
        } else if (!isAim && t.identifier === touchState.moveId) {
          touchState.moveActive = false; touchState.moveX = 0; touchState.moveY = 0
          stickEl.style.transform = 'translate(0px, 0px)'
          stickEl.className = 'w-14 h-14 rounded-full bg-sky-400/60 border-2 border-white/80 shadow-lg pointer-events-none absolute top-1/2 left-1/2 -ml-7 -mt-7 transition-transform duration-75'
          if (ascendHintEl) {
            ascendHintEl.textContent = '▲ 升空'
            ascendHintEl.className = 'text-[10px] font-bold text-sky-200/75'
          }
        }
      }
    }
    zoneEl.addEventListener('touchend', endTouch)
    zoneEl.addEventListener('touchcancel', endTouch)
  }
  bindJoystick(document.getElementById('touchMoveZone'), document.getElementById('touchMoveStick'), false)
  bindJoystick(document.getElementById('touchAimZone'), document.getElementById('touchAimStick'), true)

  syncTeamButtonsUI()
  document.querySelectorAll('.mode-btn').forEach((b) => {
    const sel = b.getAttribute('data-mode') === mode.current
    b.className = 'mode-btn px-3 py-2 rounded-xl text-center transition border ' +
      (sel ? 'border-2 border-emerald-400 bg-emerald-500/20' : 'border border-slate-700 bg-slate-950/60 hover:border-slate-500')
  })

  const triggerSecondaryTouch = (e?: Event) => {
    if (e && e.cancelable) e.preventDefault()
    inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  }
  const triggerReloadTouch = (e?: Event) => {
    if (e && e.cancelable) e.preventDefault()
    inputQueue.reload = true
  }
  const triggerInteractTouch = (e?: Event) => {
    if (e && e.cancelable) e.preventDefault()
    inputQueue.interact = true
    trySelectCapturedFlagSpawnByKey()
  }

  const touchGrenBtn = document.getElementById('touchGrenadeBtn')
  touchGrenBtn?.addEventListener('touchstart', triggerSecondaryTouch, { passive: false })
  touchGrenBtn?.addEventListener('click', () => triggerSecondaryTouch())

  const touchRelBtn = document.getElementById('touchReloadBtn')
  touchRelBtn?.addEventListener('touchstart', triggerReloadTouch, { passive: false })
  touchRelBtn?.addEventListener('click', () => triggerReloadTouch())

  const touchIntBtn = document.getElementById('touchInteractBtn')
  touchIntBtn?.addEventListener('touchstart', triggerInteractTouch, { passive: false })
  touchIntBtn?.addEventListener('click', () => triggerInteractTouch())

  syncLobbyRoleUI('host')
  updateNetStatusUI()
}
