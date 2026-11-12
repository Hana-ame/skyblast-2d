// web/main-web.ts —— 浏览器入口/组合根：装配各层模块、启动循环、暴露调试与调参句柄
import {
  canvas, world, localPlayer, bots, pendingLoadout, camera, touchState, beams,
  featureFlags, setFeatureFlag, toggleFeatureFlag, resetAllFeatureFlags,
} from './app/context.ts'
import { WEAPONS } from '../core/weapons.ts'
import { bindAllEvents } from './input/bindings.ts'
import { autoDetectDeviceInput } from './input/device.ts'
import { syncBotsCount, pickBotTarget, getBotPatrolStatus, PATROL_ROUTES } from './game/bots.ts'
import { applyPendingLoadoutAndSpawn } from './game/loadout.ts'
import { startGameLoop } from './game/loop.ts'
import { renderScene } from './render/scene.ts'
import {
  updateHudWeaponButtons, updateSpawnPointButtonsUI, updateTeamCountUI,
  updateHudUI, updateScoreboardUI, syncFeatureFlagsUI,
} from './app/hud.ts'
import { syncParamsToUI } from './app/params.ts'
import { mode } from './app/context.ts'
import { setPhysicsParams, getPhysicsParams, resetPhysicsParams } from '../core/sim/physics.ts'

// ── 启动 ──
bindAllEvents()
autoDetectDeviceInput()
localPlayer.team = 'red'   // 默认红队基地部署（FFA 出生点已移除）
syncBotsCount(4)
updateHudWeaponButtons()
updateSpawnPointButtonsUI()
updateTeamCountUI()
syncFeatureFlagsUI()
syncParamsToUI()
startGameLoop()

// 调试暴露（截图/自动化验证用）
;(window as unknown as { __dbg: unknown }).__dbg = {
  world,
  get player() { return localPlayer },
  get bots() { return bots },
  get camera() { return camera },
  get pendingLoadout() { return pendingLoadout },
  get flags() { return featureFlags },
  setFeatureFlag: (k: keyof typeof featureFlags, v: boolean) => { setFeatureFlag(k, v); syncFeatureFlagsUI() },
  toggleFeatureFlag: (k: keyof typeof featureFlags) => { const r = toggleFeatureFlag(k); syncFeatureFlagsUI(); return r },
  resetAllFeatureFlags: () => { resetAllFeatureFlags(); syncFeatureFlagsUI() },
  syncBotsCount,
  applyPendingLoadoutAndSpawn,
  render: () => { renderScene(); updateHudUI(); updateScoreboardUI(); updateHudWeaponButtons(); syncFeatureFlagsUI(); },
  get touch() { return touchState },
  botTargets: () => bots.map(b => ({
    bot: b.name,
    team: b.team,
    ...getBotPatrolStatus(b),
    target: pickBotTarget(b)?.name ?? null,
    targetTeam: pickBotTarget(b)?.team ?? null,
  })),
  patrolRoutes: PATROL_ROUTES,
  get beams() { return beams },
  get mode() { return mode.current },
  weapons: () => WEAPONS.map(w => ({ id: w.id, name: w.name, damage: w.damage, fireDelay: w.fireDelay, moveSpeedMult: w.moveSpeedMult })),
}

// 调参持久化（tuning 页共享）
;(window as unknown as { __tune: unknown }).__tune = {
  set: (p: Record<string, number>) => setPhysicsParams(p),
  get: () => getPhysicsParams(),
  reset: () => resetPhysicsParams(),
}
;(function loadSavedParams(): void {
  try {
    // 数值后台有覆盖时以后台为准，跳过旧调参页存档
    if (localStorage.getItem('pvp-balance-overrides-v1')) return
    // v2：飞行槽加倍后的默认值；旧 key 的存档（jetpackFuel 0.5）不再覆盖
    const raw = localStorage.getItem('pvp-physics-params-v2')
    if (raw) setPhysicsParams(JSON.parse(raw) as Record<string, number>)
  } catch { /* 忽略 */ }
})()