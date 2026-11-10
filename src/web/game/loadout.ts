// web/game/loadout.ts —— 待部署配装 / 出生与部署
import { world, localPlayer, pendingLoadout } from '../app/context.ts'
import { updateHudWeaponButtons, updateSpawnPointButtonsUI } from '../app/hud.ts'
import { showToast } from '../app/toast.ts'
import { WEAPONS, SECONDARIES, isSecondaryUnlocked, getHighestUnlockedSecondary } from '../../core/weapons.ts'
import { SPAWN_POINTS, isCapturePointSelectable } from '../../core/sim/world.ts'

// ── 待部署配装 ──
export function getSpawnCoords(): { x: number; y: number; label: string } {
  if (pendingLoadout.spawnPointId && pendingLoadout.spawnPointId !== 'base') {
    const cp = world.capturePoints.find(c => c.id === pendingLoadout.spawnPointId)
    if (cp && isCapturePointSelectable(cp, localPlayer.team)) {
      return { x: cp.x, y: cp.y, label: cp.name }
    }
  }
  const sp = SPAWN_POINTS.find(s => s.team === localPlayer.team) ?? SPAWN_POINTS[0]
  return { x: sp.x, y: sp.y, label: '队伍主基地' }
}

export function applyPendingLoadoutAndSpawn(): void {
  const want = Number(pendingLoadout.weaponIndex)
  const wIdx = WEAPONS[want] && !WEAPONS[want].isSupplyOnly ? want : 0
  localPlayer.weaponIndex = wIdx
  localPlayer.lastPrimaryIndex = wIdx
  const streak = localPlayer.deathStreak ?? 0
  const wantSec = pendingLoadout.secondaryType
  localPlayer.secondary = isSecondaryUnlocked(wantSec, streak, localPlayer.dollCharges ?? 0)
    ? wantSec
    : getHighestUnlockedSecondary(streak, localPlayer.dollCharges ?? 0)
  localPlayer.selectedSpawnId = pendingLoadout.spawnPointId
  localPlayer.deployed = true
  localPlayer.alive = true
  world.deploy(localPlayer)
  updateHudWeaponButtons()
  updateSpawnPointButtonsUI()
  const { label } = getSpawnCoords()
  const spLabel = world.config.randomSpawn && label === '队伍主基地' ? '随机安全点' : label
  showToast(`⚡ 已在【${spLabel}】部署！配装已锁定：${WEAPONS[wIdx].name} + ${(SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag).name}`)
}
