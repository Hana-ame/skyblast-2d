// main.ts —— 组合根：唯一组装三层的地方（依赖注入，三层互不 import）
// 合并后验证目标：Loopback 联机跑通 SkyBlast 完整玩法本地对局
//   （服务器权威 + 快照插值 + 环形大世界 + 7 主武器/8 副武器 + 占点 + 弹药经济）
import { World } from './core/sim/world.ts'
import { ServerSim } from './net/ServerSim.ts'
import { ClientSession } from './net/ClientSession.ts'
import { createLoopback } from './net/transport/Loopback.ts'
import { InputMapper } from './input/InputMapper.ts'
import type { TouchState } from './input/InputMapper.ts'
import { StateSync } from './net/StateSync.ts'
import { HUDViewModel } from './ui/HUDViewModel.ts'
import { Presenter } from './ui/Presenter.ts'
import { ScreenStateMachine } from './ui/ScreenStateMachine.ts'
import type { WorldEvent } from './core/types.ts'

const DT = 1 / 60
const TICKS = 480

// ── 组合根：组装三层 ──────────────────────────────────────────
const world = new World(20261106)          // 固定种子 → 确定性演示
const a = world.addPlayer('Alice', 'red')
const b = world.addPlayer('Bob', 'blue')
a.weaponIndex = 2                          // Alice：电磁狙击（爆头穿透）
b.weaponIndex = 1                          // Bob：突击步枪
b.pos = { x: a.pos.x + 420, y: a.pos.y }   // 拉近到对枪距离（v2 队伍出生点隔半张地图）

const server = new ServerSim(world)
const lbA = createLoopback()
const lbB = createLoopback()
server.accept(a.id, lbA.server)
server.accept(b.id, lbB.server)

const csA = new ClientSession(lbA.client, a.id)
const csB = new ClientSession(lbB.client, b.id)
const mapper = new InputMapper()
const hudA = new HUDViewModel()
const hudB = new HUDViewModel()
const presA = new Presenter(hudA)
const presB = new Presenter(hudB)
const syncA = new StateSync()
const syncB = new StateSync()
csA.onSnapshot((s) => syncA.push(s))
csB.onSnapshot((s) => syncB.push(s))

// 事件流（killfeed 演示：界面层只订阅，不读 world 内部）
const killfeed: string[] = []
const recordEvent = (ev: WorldEvent): void => {
  if (ev.kind === 'kill') {
    killfeed.push(`${ev.killerName} [${ev.weaponLabel}${ev.isHeadshot ? '·爆头' : ''}${ev.isPierced ? '·穿透' : ''}] → ${ev.victimName}`)
  } else if (ev.kind === 'capture') {
    killfeed.push(`🚩 据点 ${ev.pointCode} 被 ${ev.team} 占领`)
  } else if (ev.kind === 'obstacle_destroy') {
    killfeed.push(`🧱 障碍物 ${ev.obstacleId} 被摧毁`)
  } else if (ev.kind === 'supply_pickup') {
    killfeed.push(`📦 ${ev.weaponName} 被拾取`)
  } else if (ev.kind === 'doll_recall') {
    killfeed.push(`🎎 替身人偶回溯 (P${ev.playerId})`)
  }
}
csA.onEvents((evs) => { for (const e of evs) recordEvent(e) })

const sm = new ScreenStateMachine()
sm.transition('inGame')

// ── 对局脚本：双向对枪 + 副武器演示（Alice 手雷，Bob 护盾） ──
const touchA = (fire: boolean, sec: TouchState['secondary']): TouchState => ({
  moveX: 0, aimAngle: 0, fire, jump: false, jetpack: false, reload: false,
  interact: false, secondary: sec, switchWeapon: null,
})
const touchB = (fire: boolean, sec: TouchState['secondary']): TouchState => ({
  moveX: 0, aimAngle: Math.PI, fire, jump: false, jetpack: false, reload: false,
  interact: false, secondary: sec, switchWeapon: null,
})

console.log('=== SkyBlast 2D（合并版）· Loopback 本地对局 · 环形大世界 13200×4400 ===')
let eventsSeen = 0
for (let i = 0; i < TICKS; i++) {
  // 0-90s：对枪；Alice 在 t=2s 丢手雷，Bob 在 t=2.2s 开护盾；Alice t=4s 部署工事
  const t = i * DT
  const secA = Math.abs(t - 2.0) < DT / 2 ? { kind: 'frag', targetX: b.pos.x, targetY: b.pos.y }
    : Math.abs(t - 4.0) < DT / 2 ? { kind: 'barricade', targetX: a.pos.x + 100, targetY: a.pos.y }
    : null
  const secB = Math.abs(t - 2.2) < DT / 2 ? { kind: 'shield', targetX: 0, targetY: 0 } : null
  csA.sendIntents(mapper.map(touchA(t < 8 || (t > 9 && t < 10), secA)))
  csB.sendIntents(mapper.map(touchB(t < 8, secB)))
  server.step(DT)
  syncA.advance(DT)
  syncB.advance(DT)
  const sa = syncA.interpolated() ?? world.snapshot()
  const sb = syncB.interpolated() ?? world.snapshot()
  presA.render(sa, a.id)
  presB.render(sb, b.id)
  eventsSeen += csA.lastEvents.length
  if (i % 120 === 0) {
    console.log(presA.describe(sa, a.id))
    console.log(presB.describe(sb, b.id))
    console.log('')
  }
}

console.log('--- 对局结束 ---')
console.log(`Alice K/D=${a.kills}/${a.deaths}   Bob K/D=${b.kills}/${b.deaths}`)
console.log(`服务器权威 world: tick=${world.tick}  命中=${world.hits}  存活弹丸=${world.projectiles.length}`)
console.log(`障碍物=${world.obstacles.length}  弹药点=${world.ammoPacks.length}  占点进度=${world.capturePoints.map(c => `${c.code}:${Math.round(c.progress)}%`).join(' ')}`)
console.log(`界面状态机: ${sm.current}`)
console.log(`HUD(Alice)=${JSON.stringify(hudA.current)}`)
console.log(`事件流累计=${eventsSeen}`)
console.log('--- Killfeed ---')
for (const k of killfeed.slice(-10)) console.log(k)
