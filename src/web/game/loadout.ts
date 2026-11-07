// web/game/loadout.ts —— 待部署配装 / 出生与部署
import { world, localPlayer, pendingLoadout } from '../app/context.ts'
import { updateHudWeaponButtons } from '../app/hud.ts'
import { showToast } from '../app/toast.ts'
import { WEAPONS, SECONDARIES } from '../../core/weapons.ts'
import { SPAWN_POINTS } from '../../core/sim/world.ts'

// ── 待部署配装 ──
export function getSpawnCoords(): { x: number; y: number; label: string } {
  const sp = SPAWN_POINTS.find(s => s.team === localPlayer.team) ?? SPAWN_POINTS[3]
  return { x: sp.x, y: sp.y, label: '队伍主基地' }
}

export function applyPendingLoadoutAndSpawn(): void {
  const want = Number(pendingLoadout.weaponIndex)
  const wIdx = WEAPONS[want] && !WEAPONS[want].isSupplyOnly ? want : 0
  localPlayer.weaponIndex = wIdx
  localPlayer.lastPrimaryIndex = wIdx
  localPlayer.secondary = SECONDARIES[pendingLoadout.secondaryType] ? pendingLoadout.secondaryType : 'frag'
  localPlayer.deployed = true
  localPlayer.alive = true
  world.deploy(localPlayer)
  updateHudWeaponButtons()
  const spLabel = world.config.randomSpawn ? '随机安全点' : '队伍主基地'
  showToast(`⚡ 已在【${spLabel}】部署！配装已锁定：${WEAPONS[wIdx].name} + ${(SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag).name}`)
}

