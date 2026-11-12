// web/game/loadout.ts —— 待部署配装 / 出生与部署
import { world, localPlayer, pendingLoadout } from '../app/context.ts'
import { updateHudWeaponButtons, updateSpawnPointButtonsUI } from '../app/hud.ts'
import { showToast } from '../app/toast.ts'
import { WEAPONS, SECONDARIES, isSecondaryUnlocked, getHighestUnlockedSecondary } from '../../core/weapons.ts'
import { SPAWN_POINTS, isCapturePointSelectable } from '../../core/sim/world.ts'
import { sendClientLoadoutToHost, netState } from '../app/net.ts'

// ── 待部署配装 ──
export function getSpawnCoords(): { x: number; y: number; label: string } {
  if (pendingLoadout.spawnPointId && pendingLoadout.spawnPointId !== 'base') {
    const cp = world.capturePoints.find(c => c.id === pendingLoadout.spawnPointId)
    if (cp && isCapturePointSelectable(cp, localPlayer.team)) {
      return { x: cp.x, y: cp.y, label: cp.name }
    }
  }
  if (localPlayer.team === 'ffa') {
    return { x: localPlayer.pos.x, y: localPlayer.pos.y, label: 'FFA随机出生点（红蓝通打）' }
  }
  const sp = SPAWN_POINTS.find(s => s.team === localPlayer.team) ?? SPAWN_POINTS[0]
  return { x: sp.x, y: sp.y, label: localPlayer.team === 'blue' ? '蓝队右翼主基地' : '红队左翼主基地' }
}

export function applyPendingLoadoutAndSpawn(): void {
  const want = Number(pendingLoadout.weaponIndex)
  const wIdx = WEAPONS[want] && !WEAPONS[want].isSupplyOnly ? want : 0
  localPlayer.weaponIndex = wIdx
  localPlayer.lastPrimaryIndex = wIdx
  const streak = localPlayer.deathStreak ?? 0
  const wantSec = pendingLoadout.secondaryType
  localPlayer.secondary = isSecondaryUnlocked(wantSec, streak, localPlayer.dollCharges ?? 0, wIdx)
    ? wantSec
    : 'frag'
  pendingLoadout.secondaryType = localPlayer.secondary
  localPlayer.selectedSpawnId = pendingLoadout.spawnPointId
  localPlayer.deployed = true
  localPlayer.alive = true
  world.deploy(localPlayer)
  if (netState.role === 'client') {
    sendClientLoadoutToHost(true)
  }
  updateHudWeaponButtons()
  updateSpawnPointButtonsUI()
  const { label } = getSpawnCoords()
  const spLabel = world.config.randomSpawn && localPlayer.team !== 'ffa' && label.includes('主基地') ? '随机安全点' : label
  showToast(`⚡ 已在【${spLabel}】部署！配装：${WEAPONS[wIdx].name} + ${(SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag).name}`)
}
