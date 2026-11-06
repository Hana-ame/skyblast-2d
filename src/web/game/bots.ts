// web/game/bots.ts —— AI 机器人（数量同步 / 目标选择 / 权威输入）
import { botNames, botTeams, botSecs, bots, world, localPlayer, mode } from '../app/context.ts'
import { updateTeamCountUI } from '../app/hud.ts'
import { WEAPONS, SECONDARIES } from '../../core/weapons.ts'
import { wrapDist, wrapDeltaX, wrapDeltaY, wrapX, clamp } from '../../core/wrap.ts'
import { getPhysicsParams } from '../../core/sim/physics.ts'
import { defaultWorldInput } from '../../core/types.ts'
import type { WorldInput, PlayerState, TeamId } from '../../core/types.ts'

export function syncBotsCount(target: number): void {
  while (bots.length > target) {
    const b = bots.pop()!
    world.players = world.players.filter(p => p.id !== b.id)
  }
  while (bots.length < target) {
    const idx = bots.length
    let team: TeamId
    if (mode.current === 'ffa') {
      team = 'ffa'
    } else {
      // 2 队对抗：红蓝均衡（玩家所在队伍优先补对手）
      team = idx % 2 === 0 ? 'red' : 'blue'
      if (team === localPlayer.team) team = team === 'red' ? 'blue' : 'red'
    }
    const b = world.addPlayer(botNames[idx % botNames.length], team)
    b.weaponIndex = idx % 4
    b.secondary = botSecs[idx % botSecs.length]
    const cp = world.capturePoints[idx % world.capturePoints.length]
    b.pos = { x: wrapX(cp.x + (idx - 4) * 47), y: cp.y - 50 }
    bots.push(b)
  }
  // 模式变更时同步既有 bot 队伍：FFA 全员混战；2 队按红蓝均衡（避开玩家队伍）
  bots.forEach((b, idx) => {
    if (mode.current === 'ffa') {
      b.team = 'ffa'
    } else {
      let team: TeamId = idx % 2 === 0 ? 'red' : 'blue'
      if (team === localPlayer.team) team = team === 'red' ? 'blue' : 'red'
      b.team = team
    }
  })
  updateTeamCountUI()
}


// ── AI 输入（服务器权威） ──
/** 目标选择：只选不同队伍（ffa 除外）——修复"AI 打同队队友" */
export function pickBotTarget(bot: PlayerState): PlayerState | null {
  const enemies = [localPlayer, ...bots.filter(b => b !== bot)].filter(e =>
    e.deployed && e.alive && e.respawnTimer <= 0 && (bot.team === 'ffa' || e.team !== bot.team))
  let target: PlayerState | null = null
  let best = Infinity
  for (const e of enemies) {
    const d = wrapDist(bot.pos.x, bot.pos.y, e.pos.x, e.pos.y)
    if (d < best) { best = d; target = e }
  }
  return target
}

export function botInput(bot: PlayerState): WorldInput {
  const w = defaultWorldInput()
  const target = pickBotTarget(bot)
  if (!target) return w
  const dx = wrapDeltaX(bot.pos.x, target.pos.x)
  const dy = wrapDeltaY(bot.pos.y - 12, target.pos.y - 12)
  w.aim = Math.atan2(dy, dx)
  if (Math.abs(dx) > 340) w.move = dx > 0 ? 1 : -1
  else if (Math.abs(dx) < 150) w.move = dx > 0 ? -1 : 1
  w.fire = world.tick % 12 < 5 && Math.abs(dx) < 900
  w.jetpack = target.pos.y + 80 < bot.pos.y
  return w
}

