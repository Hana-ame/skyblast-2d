// web/input/bindings.ts —— 全部 DOM 事件绑定（键鼠/触屏/大厅/死亡界面/参数台/按钮）
import {
  canvas, world, localPlayer, bots, pendingLoadout, mode,
  keys, mouse, touchState, inputQueue, camera, resizeCanvas,
} from '../app/context.ts'
import { showToast } from '../app/toast.ts'
import {
  updateHudWeaponButtons, updateSpawnPointButtonsUI, updateTeamCountUI,
  tryChangePrimaryWeapon, tryChangeSecondaryWeapon, updateHudUI,
} from '../app/hud.ts'
import { syncParamsToUI, bindRangeParam, paramState } from '../app/params.ts'
import { updateInputModeBadge, setTouchLayerVisible, autoDetectDeviceInput } from './device.ts'
import { syncBotsCount } from '../game/bots.ts'
import { applyPendingLoadoutAndSpawn, getSpawnCoords } from '../game/loadout.ts'
import { setPhysicsParams, getPhysicsParams, resetPhysicsParams } from '../../core/sim/physics.ts'
import { WEAPONS, SECONDARIES, DEFAULT_CONFIG } from '../../core/weapons.ts'
import { SPAWN_POINTS } from '../../core/sim/world.ts'
import { clamp } from '../../core/wrap.ts'
import type { TeamId } from '../../core/types.ts'

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
    else if (e.code === 'KeyE') inputQueue.interact = true
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
        if (!cp || (cp.ownerTeam !== localPlayer.team && localPlayer.team !== 'ffa')) {
          showToast('⚠️ 该占领点尚未被我方队伍占领，暂不可作为重生点！')
          return
        }
      }
      pendingLoadout.spawnPointId = spId
      updateSpawnPointButtonsUI()
    })
  })

  document.querySelectorAll('.bot-count-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cnt = Number(btn.getAttribute('data-bots') || 0)
      syncBotsCount(cnt)
      document.querySelectorAll('.bot-count-btn').forEach((b) => {
        b.className = Number(b.getAttribute('data-bots')) === cnt
          ? 'bot-count-btn px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-xs'
          : 'bot-count-btn px-2.5 py-1 rounded-lg bg-slate-950 text-slate-300 font-semibold text-xs border border-slate-700'
      })
    })
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
  document.getElementById('hudQuickMortarBtn')?.addEventListener('click', () => { inputQueue.interact = true })
  document.getElementById('interactBannerBtn')?.addEventListener('click', () => {
    if (!localPlayer.deployed || localPlayer.respawnTimer > 0) {
      const lobby = document.getElementById('lobbyModal')
      lobby?.classList.remove('hidden')
      lobby?.classList.add('flex')
      updateSpawnPointButtonsUI()
    } else inputQueue.interact = true
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
    // FFA：全员混战；2 队：默认红队（可再点蓝）
    if (nextMode === 'ffa') localPlayer.team = 'ffa'
    else if (localPlayer.team !== 'blue') localPlayer.team = 'red'
    syncBotsCount(bots.length)
    applyTeamButtons()
    updateTeamCountUI()
    showToast(nextMode === 'ffa'
      ? '🟡 自由混战：全员皆敌，随机出生点'
      : '⚔️ 双队对抗（红队 vs 蓝队）：随机出生点')
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
    showToast('全图可破坏障碍物、地雷与弹药补给已全部重置')
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

  // 初始化死斗模式 UI（默认 FFA）
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
  document.getElementById('touchInteractBtn')?.addEventListener('click', () => { inputQueue.interact = true })
}

