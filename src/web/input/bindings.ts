import { defaultMapData, carveTunnelInSolids, MAIN_DECK_TOP, UNIFIED_EDGE_HIGHLIGHT } from '../../core/map.ts'
import type { MapSolid } from '../../core/map.ts'
import { FFA_SPAWN_POINTS, AMMO_SPOTS, CENTER_RESPAWN_POINT } from '../../core/sim/world.ts'
import { getTerrainPattern } from '../textures.ts'
// web/input/bindings.ts —— 全部 DOM 事件绑定（键鼠/触屏/大厅/死亡界面/参数台/PeerJS+KCP联机按钮）
import {
  canvas, world, localPlayer, bots, pendingLoadout, mode,
  keys, mouse, touchState, inputQueue, resizeCanvas,
} from '../app/context.ts'
import { showToast } from '../app/toast.ts'
import {
  updateHudWeaponButtons, updateSpawnPointButtonsUI, updateTeamCountUI,
  tryChangePrimaryWeapon, tryChangeSecondaryWeapon,
} from '../app/hud.ts'
import {
  startHostRoom, joinHostRoom, leaveMultiplayerRoom, runDualWebRtcKcpSelfTest, updateNetStatusUI,
} from '../app/net.ts'
import { syncParamsToUI, bindRangeParam, paramState } from '../app/params.ts'
import { setTouchLayerVisible } from './device.ts'
import { syncBotsCount } from '../game/bots.ts'
import { applyPendingLoadoutAndSpawn } from '../game/loadout.ts'
import { setPhysicsParams, resetPhysicsParams } from '../../core/sim/physics.ts'
import { isCapturePointSelectable } from '../../core/sim/world.ts'
import { WEAPONS, DEFAULT_CONFIG } from '../../core/weapons.ts'
import type { TeamId } from '../../core/types.ts'

/** 尝试通过按 E 或快捷交互选中已占领的正中旗帜复活点 */
export function trySelectCapturedFlagSpawnByKey(): boolean {
  const cp = world.capturePoints.find(c => c.id === 'cp_c' && isCapturePointSelectable(c, localPlayer.team))
    ?? world.capturePoints.find(c => isCapturePointSelectable(c, localPlayer.team))
  if (!cp) return false
  pendingLoadout.spawnPointId = cp.id
  localPlayer.selectedSpawnId = cp.id
  updateSpawnPointButtonsUI()
  showToast(`🚩 已选中【${cp.name}】作为复活点！`)
  return true
}

// ── 事件绑定 ──
export function bindAllEvents(): void {
  window.addEventListener('resize', resizeCanvas)
  resizeCanvas()

  window.addEventListener('keydown', (e) => {
    const active = document.activeElement
    if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return
    keys[e.code] = true
    if (e.code === 'KeyR') inputQueue.reload = true
    else if (e.code === 'KeyG' || e.code === 'KeyQ') inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
    else if (e.code === 'KeyE') {
      inputQueue.interact = true
      trySelectCapturedFlagSpawnByKey()
    }
    else if (e.code === 'Digit1') tryChangePrimaryWeapon(0)
    else if (e.code === 'Digit2') tryChangePrimaryWeapon(1)
    else if (e.code === 'Digit3') tryChangePrimaryWeapon(2)
    else if (e.code === 'Digit4') tryChangePrimaryWeapon(3)
    else if (e.code === 'Digit5') tryChangePrimaryWeapon(7)
  })
  window.addEventListener('keyup', (e) => { keys[e.code] = false })

  canvas?.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect()
    mouse.x = e.clientX - rect.left
    mouse.y = e.clientY - rect.top
  })
  canvas?.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouse.down = true
    else if (e.button === 2) inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  canvas?.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false })
  canvas?.addEventListener('contextmenu', (e) => e.preventDefault())

  document.querySelectorAll('.lobby-wep-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangePrimaryWeapon(Number(btn.getAttribute('data-wep') || 0))))
  document.querySelectorAll('.lobby-sec-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangeSecondaryWeapon(btn.getAttribute('data-sec') || 'frag')))
  // 死亡界面：唯一的换枪入口
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
          showToast('⚠️ 该旗帜复活点尚未占领，占领后即可选中（也可按 E 选中）！')
          return
        }
      }
      pendingLoadout.spawnPointId = spId
      localPlayer.selectedSpawnId = spId
      updateSpawnPointButtonsUI()
      showToast(spId === 'base' ? '🏠 已切换复活点为【队伍主基地】' : '🚩 已选中【正中复活点】！')
    })
  })

  document.querySelectorAll('.bot-count-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cnt = Number(btn.getAttribute('data-bots') || 0)
      syncBotsCount(cnt)
      updateNetStatusUI()
      document.querySelectorAll('.bot-count-btn').forEach((b) => {
        b.className = Number(b.getAttribute('data-bots')) === cnt
          ? 'bot-count-btn px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-xs'
          : 'bot-count-btn px-2.5 py-1 rounded-lg bg-slate-950 text-slate-300 font-semibold text-xs border border-slate-700'
      })
    })
  })

  // PeerJS + WebRTC 自定义 KCP 联机控制台事件绑定
  document.getElementById('peerHostBtn')?.addEventListener('click', () => {
    startHostRoom()
  })
  document.getElementById('peerCopyIdBtn')?.addEventListener('click', () => {
    const inp = document.getElementById('peerLocalIdInput') as HTMLInputElement | null
    const val = inp?.value?.trim() || ''
    if (!val) {
      showToast('⚠️ 请先点击「创建 KCP 房间」生成房间码')
      return
    }
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
    showToast(`📋 已复制 KCP 房间码：${val}`)
  })
  document.getElementById('peerJoinBtn')?.addEventListener('click', () => {
    const inp = document.getElementById('peerRemoteIdInput') as HTMLInputElement | null
    void joinHostRoom(inp?.value || '')
  })
  document.getElementById('peerLeaveBtn')?.addEventListener('click', () => {
    leaveMultiplayerRoom()
  })
  document.getElementById('peerLoopbackTestBtn')?.addEventListener('click', () => {
    void runDualWebRtcKcpSelfTest()
  })

  document.querySelectorAll('.param-wep-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      paramState.weaponIdx = Number(btn.getAttribute('data-pwep') || 0)
      syncParamsToUI()
    })
  })

  document.getElementById('hudReloadBtn')?.addEventListener('click', () => { inputQueue.reload = true })
  document.getElementById('hudGrenadeBtn')?.addEventListener('click', () => {
    inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  document.getElementById('hudQuickMortarBtn')?.addEventListener('click', () => {
    inputQueue.interact = true
    trySelectCapturedFlagSpawnByKey()
  })
  // 内嵌增强版地图编辑器逻辑
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
    c.fillRect(sx(0), sy(MAIN_DECK_TOP), 13200 * igeCam.zoom, (2800 - MAIN_DECK_TOP) * igeCam.zoom)
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
    for (const sp of FFA_SPAWN_POINTS) {
      c.fillStyle = '#facc15'
      c.beginPath(); c.arc(sx(sp.x), sy(sp.y), 4.5, 0, Math.PI * 2); c.fill()
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
    if (st) st.textContent = `${igeSolids.length} 块 · 统一高亮 ${UNIFIED_EDGE_HIGHLIGHT}`
  }

  document.getElementById('openEditorBtn')?.addEventListener('click', () => {
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
    showToast(`✅ 已将编辑器地图（${igeSolids.length} 块）实时应用到当前对局！`)
  })
  document.getElementById('igeExportPng')?.addEventListener('click', () => {
    const off = document.createElement('canvas')
    off.width = 2640; off.height = 880
    const c = off.getContext('2d')!
    c.fillStyle = '#040812'; c.fillRect(0, 0, off.width, off.height)
    c.save(); c.scale(off.width / 13200, off.height / 4400)
    const pat = getTerrainPattern(c, 'block')
    c.fillStyle = pat ?? '#162032'
    c.fillRect(0, 2800, 13200, 1600)
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
  document.getElementById('openAdminBtn')?.addEventListener('click', () => { window.open('./admin.html', '_blank') })
  document.getElementById('interactBannerBtn')?.addEventListener('click', () => {
    if (!localPlayer.deployed || localPlayer.respawnTimer > 0) {
      const lobby = document.getElementById('lobbyModal')
      lobby?.classList.remove('hidden')
      lobby?.classList.add('flex')
      updateSpawnPointButtonsUI()
    } else {
      inputQueue.interact = true
      trySelectCapturedFlagSpawnByKey()
    }
  })

  // ── 对战模式按钮组：自由混战 / 双队对抗 ──
  function applyTeamButtons(): void {
    document.querySelectorAll('.team-select-btn').forEach((b) => {
      const t = b.getAttribute('data-team')
      const enabled = mode.current === '2teams' ? (t === 'red' || t === 'blue') : (t === 'ffa')
      const sel = t === localPlayer.team
      ;(b as HTMLButtonElement).disabled = !enabled
      b.className = 'team-select-btn px-3 py-2 rounded-xl text-left transition flex items-center justify-between ' +
        (sel ? 'border-2 border-indigo-400 bg-indigo-500/20 ' : 'border border-slate-700 bg-slate-950/60 ') +
        (enabled ? '' : 'opacity-40 cursor-not-allowed')
    })
  }
  function applyMode(nextMode: 'ffa' | '2teams'): void {
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      showToast('⚠️ 切换对战模式需在待机/阵亡整备时进行')
      return
    }
    mode.current = nextMode
    document.querySelectorAll('.mode-btn').forEach((b) => {
      const sel = b.getAttribute('data-mode') === nextMode
      b.className = 'mode-btn px-3 py-2 rounded-xl text-left transition border ' +
        (sel ? 'border-2 border-emerald-400 bg-emerald-500/20' : 'border border-slate-700 bg-slate-950/60 hover:border-slate-500')
    })
    if (nextMode === 'ffa') localPlayer.team = 'ffa'
    else if (localPlayer.team !== 'blue') localPlayer.team = 'red'
    syncBotsCount(bots.length)
    applyTeamButtons()
    updateTeamCountUI()
    updateSpawnPointButtonsUI()
    showToast(nextMode === 'ffa'
      ? '🟡 自由混战：全员皆敌（占领正中旗帜后可选中正中复活点）'
      : '⚔️ 双队对抗（红队 vs 蓝队）：左右基地部署，占领正中旗帜后可按 E 选中复活点')
  }
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => applyMode((b.getAttribute('data-mode') || 'ffa') as 'ffa' | '2teams'))
  })

  document.querySelectorAll('.team-select-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if ((btn as HTMLButtonElement).disabled) return
      const chosen = (btn.getAttribute('data-team') || 'red') as TeamId
      localPlayer.team = chosen
      applyTeamButtons()
      updateTeamCountUI()
      updateSpawnPointButtonsUI()
    })
  })

  document.getElementById('playerNameInput')?.addEventListener('input', (e) => {
    localPlayer.name = (e.target as HTMLInputElement).value.trim() || 'SkyHunter'
  })

  const lobbyModal = document.getElementById('lobbyModal')
  document.getElementById('openLobbyBtn')?.addEventListener('click', () => {
    lobbyModal?.classList.remove('hidden')
    lobbyModal?.classList.add('flex')
    updateSpawnPointButtonsUI()
  })
  document.getElementById('startBattleBtn')?.addEventListener('click', () => {
    if (!localPlayer.deployed || localPlayer.respawnTimer > 0) applyPendingLoadoutAndSpawn()
    lobbyModal?.classList.add('hidden')
    lobbyModal?.classList.remove('flex')
  })
  document.getElementById('inputDeviceDetectBadge')?.addEventListener('click', () => setTouchLayerVisible(!touchState.enabled, false))
  document.getElementById('toggleTouchBtn')?.addEventListener('click', () => setTouchLayerVisible(!touchState.enabled, false))
  document.getElementById('resetTerrainBtn')?.addEventListener('click', () => {
    world.resetMatch()
    pendingLoadout.spawnPointId = 'base'
    localPlayer.selectedSpawnId = 'base'
    updateSpawnPointButtonsUI()
    showToast('全图可破坏障碍物与正中旗帜状态已重置')
  })

  const paramsModal = document.getElementById('paramsModal')
  const openParams = (): void => {
    paramsModal?.classList.remove('hidden')
    paramsModal?.classList.add('flex')
    syncParamsToUI()
  }
  const closeParams = (): void => {
    paramsModal?.classList.add('hidden')
    paramsModal?.classList.remove('flex')
  }
  document.getElementById('openParamsBtn')?.addEventListener('click', openParams)
  document.getElementById('lobbyOpenParamsBtn')?.addEventListener('click', openParams)
  document.getElementById('closeParamsBtn')?.addEventListener('click', closeParams)
  document.getElementById('resetParamsBtn')?.addEventListener('click', () => {
    resetPhysicsParams()
    world.config = { ...DEFAULT_CONFIG }
    syncParamsToUI()
    showToast('已恢复默认参数')
  })

  bindRangeParam('paramGravity', 'valGravity', '', (v) => setPhysicsParams({ gravity: v }))
  bindRangeParam('paramMoveSpeed', 'valMoveSpeed', '', (v) => setPhysicsParams({ moveSpeed: v }))
  bindRangeParam('paramJetpackAccel', 'valJetpackAccel', '', (v) => setPhysicsParams({ jetpackAccel: v }))
  bindRangeParam('paramJetpackMaxUp', 'valJetpackMaxUp', '', (v) => setPhysicsParams({ jetpackMaxUp: v }))
  bindRangeParam('paramMaxHp', 'valMaxHp', '', (v) => {
    world.config.maxHp = v
    for (const p of world.players) { p.maxHp = v; if (p.hp > v) p.hp = v }
  })
  bindRangeParam('paramHeadRadius', 'valHeadRadius', '', (v) => { world.config.headRadius = v })
  bindRangeParam('paramWepDamage', 'valWepDamage', '', (v) => { WEAPONS[paramState.weaponIdx].damage = v })
  bindRangeParam('paramWepHeadshot', 'valWepHeadshot', 'x', (v) => { WEAPONS[paramState.weaponIdx].headshotMult = v })
  bindRangeParam('paramWepSpeed', 'valWepSpeed', '', (v) => { WEAPONS[paramState.weaponIdx].speed = v })
  bindRangeParam('paramWepMag', 'valWepMag', '', (v) => { WEAPONS[paramState.weaponIdx].magSize = v })
  bindRangeParam('paramWepReload', 'valWepReload', 's', (v) => { WEAPONS[paramState.weaponIdx].reloadTime = v })
  bindRangeParam('paramGrenadeDmg', 'valGrenadeDmg', '', (v) => { world.config.grenadeDamage = v })
  bindRangeParam('paramGrenadeRadius', 'valGrenadeRadius', '', (v) => { world.config.grenadeRadius = v })
  bindRangeParam('paramMineDmg', 'valMineDmg', '', (v) => { world.config.mineDamage = v })
  bindRangeParam('paramMineRadius', 'valMineRadius', '', (v) => { world.config.mineTriggerRadius = v })
  bindRangeParam('paramMortarDmg', 'valMortarDmg', '', (v) => { world.config.mortarDamage = v })
  bindRangeParam('paramMortarRadius', 'valMortarRadius', '', (v) => { world.config.mortarRadius = v })
  bindRangeParam('paramRespawnDelay', 'valRespawnDelay', 's', (v) => { world.config.respawnDelay = v })
  bindRangeParam('paramDollMax', 'valDollMax', '', (v) => { world.config.dollMaxCharges = v })

  // 触屏双摇杆
  function bindJoystick(zoneEl: HTMLElement | null, stickEl: HTMLElement | null, isAim: boolean): void {
    if (!zoneEl || !stickEl) return
    const maxDist = 46
    const handleMove = (clientX: number, clientY: number): void => {
      const rect = zoneEl.getBoundingClientRect()
      let dx = clientX - (rect.left + rect.width / 2)
      let dy = clientY - (rect.top + rect.height / 2)
      const dist = Math.hypot(dx, dy)
      if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist }
      stickEl.style.transform = `translate(${dx}px, ${dy}px)`
      if (isAim) { touchState.aimX = dx / maxDist; touchState.aimY = dy / maxDist }
      else { touchState.moveX = dx / maxDist; touchState.moveY = dy / maxDist }
    }
    zoneEl.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (!touchState.enabled) setTouchLayerVisible(true, true)
      const t = e.changedTouches[0]
      if (isAim) { touchState.aimActive = true; touchState.aimId = t.identifier }
      else { touchState.moveActive = true; touchState.moveId = t.identifier }
      handleMove(t.clientX, t.clientY)
    }, { passive: false })
    zoneEl.addEventListener('touchmove', (e) => {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        if ((isAim && t.identifier === touchState.aimId) || (!isAim && t.identifier === touchState.moveId)) handleMove(t.clientX, t.clientY)
      }
    }, { passive: false })
    const endTouch = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (isAim && t.identifier === touchState.aimId) {
          touchState.aimActive = false; touchState.aimX = 0; touchState.aimY = 0
          stickEl.style.transform = 'translate(0px, 0px)'
        } else if (!isAim && t.identifier === touchState.moveId) {
          touchState.moveActive = false; touchState.moveX = 0; touchState.moveY = 0
          stickEl.style.transform = 'translate(0px, 0px)'
        }
      }
    }
    zoneEl.addEventListener('touchend', endTouch)
    zoneEl.addEventListener('touchcancel', endTouch)
  }
  bindJoystick(document.getElementById('touchMoveZone'), document.getElementById('touchMoveStick'), false)
  bindJoystick(document.getElementById('touchAimZone'), document.getElementById('touchAimStick'), true)

  applyTeamButtons()
  document.querySelectorAll('.mode-btn').forEach((b) => {
    const sel = b.getAttribute('data-mode') === mode.current
    b.className = 'mode-btn px-3 py-2 rounded-xl text-left transition border ' +
      (sel ? 'border-2 border-emerald-400 bg-emerald-500/20' : 'border border-slate-700 bg-slate-950/60 hover:border-slate-500')
  })

  const boostBtn = document.getElementById('touchBoostBtn')
  boostBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); touchState.boostButtonDown = true }, { passive: false })
  boostBtn?.addEventListener('touchend', () => { touchState.boostButtonDown = false })
  document.getElementById('touchGrenadeBtn')?.addEventListener('click', () => {
    inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  document.getElementById('touchReloadBtn')?.addEventListener('click', () => { inputQueue.reload = true })
  document.getElementById('touchInteractBtn')?.addEventListener('click', () => {
    inputQueue.interact = true
    trySelectCapturedFlagSpawnByKey()
  })
  updateNetStatusUI()
}
