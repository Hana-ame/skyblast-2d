// web/game/loop.ts —— 固定步长主循环 / 本机输入 / 阵亡与重生
import {
  canvas, world, localPlayer, bots, mode, pendingLoadout, keys, mouse, touchState, inputQueue,
  effects, beams, camera, FIXED,
} from '../app/context.ts'
import { updateHudWeaponButtons, updateHudUI, updateScoreboardUI } from '../app/hud.ts'
import { showToast } from '../app/toast.ts'
import { handleEvents, death } from '../app/events.ts'
import { botInput } from './bots.ts'
import { renderScene } from '../render/scene.ts'
import { WEAPONS, SECONDARIES } from '../../core/weapons.ts'
import { getPhysicsParams } from '../../core/sim/physics.ts'
import { defaultWorldInput } from '../../core/types.ts'
import type { WorldInput } from '../../core/types.ts'
import { wrapDeltaX, wrapDeltaY, wrapX, wrapY, clamp } from '../../core/wrap.ts'

// ── 主循环 ──
let playerInput: WorldInput = defaultWorldInput()
let prevFireCooldown = 0
let lastFrame = performance.now()
let acc = 0
let wasDead = false

function buildLocalInput(): WorldInput {
  const w = defaultWorldInput()
  if (!localPlayer.deployed) return w
  if (localPlayer.respawnTimer > 0) {
    // 阵亡等待期：仍可操作大厅（不产生战斗输入）
    if (inputQueue.interact) { inputQueue.interact = false; return w }
    return w
  }
  const left = !!(keys['KeyA'] || keys['ArrowLeft'])
  const right = !!(keys['KeyD'] || keys['ArrowRight'])
  let move: -1 | 0 | 1 = left === right ? 0 : (left ? -1 : 1)
  if (touchState.moveActive && Math.abs(touchState.moveX) > 0.18) move = touchState.moveX > 0 ? 1 : -1
  w.move = localPlayer.mountedTowerId ? 0 : move
  w.jetpack = !!(keys['KeyW'] || keys['Space'] || keys['ArrowUp']) || touchState.boostButtonDown || (touchState.moveActive && touchState.moveY < -0.32)
  // 下降加速：S / ↓ / 左摇杆下推；水平仍为零惯性（松手即停）
  w.dive = !!(keys['KeyS'] || keys['ArrowDown']) || (touchState.moveActive && touchState.moveY > 0.45)

  const mounted = world.mortars.find(m => m.operatorId === localPlayer.id)
  // 屏幕空间瞄准：玩家在屏幕上的位置 = 画布中心 + 绕行最短位移×缩放；
  // 角度直接用「鼠标像素 - 玩家像素」算，避免相机跟随 aim 造成的反馈回路（此前的"鼠标瞄不准"根因）。
  const zoom = 1 / camera.fovFactor
  const psx = canvas.width / 2 + wrapDeltaX(camera.x, localPlayer.pos.x) * zoom
  const psy = canvas.height / 2 + wrapDeltaY(camera.y, localPlayer.pos.y) * zoom
  if (mounted) {
    w.aim = Math.atan2(mouse.y - psy, mouse.x - psx)
  } else if (touchState.aimActive && Math.hypot(touchState.aimX, touchState.aimY) > 0.15) {
    w.aim = Math.atan2(touchState.aimY, touchState.aimX)
  } else {
    w.aim = Math.atan2(mouse.y - (psy - 12 * zoom), mouse.x - psx)
  }
  w.fire = mouse.down || (touchState.aimActive && Math.hypot(touchState.aimX, touchState.aimY) > 0.45)
  w.interact = inputQueue.interact
  w.reload = inputQueue.reload
  if (inputQueue.secondary) w.secondary = { type: inputQueue.secondary.type, targetX: inputQueue.secondary.targetX, targetY: inputQueue.secondary.targetY }
  return w
}

function onLocalDeath(): void {
  // 阵亡：打开死亡界面（唯一可换枪处），默认选中「上次的常规主武器」
  // （拿着补给特武时不能把选择回落到 0，否则玩家会莫名丢掉原本的主武器）
  const cur = WEAPONS[localPlayer.weaponIndex]
  const lastIdx = localPlayer.lastPrimaryIndex ?? localPlayer.weaponIndex
  const last = WEAPONS[lastIdx]
  pendingLoadout.weaponIndex = cur && !cur.isSupplyOnly
    ? localPlayer.weaponIndex
    : (last && !last.isSupplyOnly ? lastIdx : 0)
  pendingLoadout.secondaryType = localPlayer.secondary === 'doll' ? 'frag' : localPlayer.secondary
  updateHudWeaponButtons()
  const ds = document.getElementById('deathScreen')
  if (ds) ds.classList.remove('hidden')
  showToast('💀 已阵亡：在死亡界面选择重生配装')
}

function onLocalRespawn(): void {
  // 出生位置已由权威端决定（死斗=随机安全点）；这里只把待定配装套到已重生的玩家上
  const wantW = Number(pendingLoadout.weaponIndex)
  const next = WEAPONS[wantW] && !WEAPONS[wantW].isSupplyOnly ? wantW : 0
  localPlayer.weaponIndex = next
  localPlayer.lastPrimaryIndex = next
  localPlayer.secondary = SECONDARIES[pendingLoadout.secondaryType] ? pendingLoadout.secondaryType : 'frag'
  updateHudWeaponButtons()
  showToast(world.config.randomSpawn ? '🔄 已在随机安全点重生' : '🔄 已在队伍基地重生')
}

export function startGameLoop(): void {
  lastFrame = performance.now()
  requestAnimationFrame(function gameLoop(now: number): void {
    const dt = Math.min(0.05, (now - lastFrame) / 1000)
  lastFrame = now
  acc += dt
  let guard = 0

  while (acc >= FIXED && guard < 5) {
    playerInput = buildLocalInput()
    inputQueue.interact = false
    inputQueue.reload = false
    inputQueue.secondary = null

    const inputs = new Map<number, WorldInput>([[localPlayer.id, playerInput]])
    for (const b of bots) inputs.set(b.id, botInput(b))
    world.step(FIXED, inputs)
    handleEvents(world.drainEvents())

    const dead = localPlayer.respawnTimer > 0
    if (dead && !wasDead) onLocalDeath()
    if (!dead && wasDead) onLocalRespawn()
    wasDead = dead
    // 死亡界面：显示/隐藏 + 倒计时 + 击杀者
    const deathEl = document.getElementById('deathScreen')
    if (deathEl) {
      deathEl.classList.toggle('hidden', !dead)
      deathEl.classList.toggle('flex', dead)
      if (dead) {
        const cd = document.getElementById('deathCountdown')
        if (cd) cd.textContent = localPlayer.respawnTimer.toFixed(1)
        const kl = document.getElementById('deathKillerLine')
        if (kl) kl.textContent = death.info
          ? `被 ${death.info.killer}${death.info.weapon ? ` 的 ${death.info.weapon}` : ''} 击杀`
          : '等待重生…'
      }
    }

    // 表现层：粒子/光束寿命 + 喷气尾焰 + 枪口火焰
    effects.update(FIXED)
    for (let i = beams.length - 1; i >= 0; i--) {
      beams[i].life -= FIXED
      if (beams[i].life <= 0) beams.splice(i, 1)
    }
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      if (localPlayer.jetpack) {
        const back = Math.cos(localPlayer.aim) >= 0 ? -1 : 1
        effects.jet(localPlayer.pos.x + back * 14, localPlayer.pos.y + 6)
      }
      // fireCooldown 被重新点满 → 视为开火，喷枪口火焰
      if (localPlayer.fireCooldown > prevFireCooldown + 0.01) {
        const w = WEAPONS[localPlayer.weaponIndex]
        effects.muzzle(
          localPlayer.pos.x + Math.cos(localPlayer.aim) * 26,
          localPlayer.pos.y - 12 + Math.sin(localPlayer.aim) * 26,
          w?.color ?? '#fbbf24',
        )
      }
    }
    prevFireCooldown = localPlayer.fireCooldown

    acc -= FIXED
    guard++
  }

  // 鼠标世界坐标（屏幕中心 = 相机）
  mouse.worldX = wrapX(camera.x + (mouse.x - canvas.width / 2) * camera.fovFactor)
  mouse.worldY = wrapY(camera.y + (mouse.y - canvas.height / 2) * camera.fovFactor)

    renderScene()
    updateHudUI()
    updateScoreboardUI()
    requestAnimationFrame(gameLoop)
  })
}

