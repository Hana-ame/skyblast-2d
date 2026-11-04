// main.ts —— 组合根：唯一组装三层的地方（依赖注入，三层互不 import）
// 验证目标：Loopback 联机跑通本地对局（服务器权威 + 快照插值 + 三层分离）
import { World, GROUND_Y } from './core/sim/world.ts'
import { ServerSim } from './net/ServerSim.ts'
import { ClientSession } from './net/ClientSession.ts'
import { createLoopback } from './net/transport/Loopback.ts'
import { InputMapper } from './input/InputMapper.ts'
import type { TouchState } from './input/InputMapper.ts'
import { StateSync } from './net/StateSync.ts'
import { HUDViewModel } from './ui/HUDViewModel.ts'
import { Presenter } from './ui/Presenter.ts'
import { ScreenStateMachine } from './ui/ScreenStateMachine.ts'

const DT = 1 / 60
const TICKS = 240

// ── 组合根：组装三层 ──────────────────────────────────────────
const world = new World()
const a = world.addPlayer(200, GROUND_Y)
const b = world.addPlayer(760, GROUND_Y)

const server = new ServerSim(world)              // 联机层：权威
const lbA = createLoopback()
const lbB = createLoopback()
server.accept(a.id, lbA.server)
server.accept(b.id, lbB.server)

const csA = new ClientSession(lbA.client, a.id)  // 联机层：客户端
const csB = new ClientSession(lbB.client, b.id)

const mapper = new InputMapper()                 // 操作层
const hudA = new HUDViewModel()                  // 界面层
const hudB = new HUDViewModel()
const presA = new Presenter(hudA)
const presB = new Presenter(hudB)
const syncA = new StateSync()                    // 联机层：插值
const syncB = new StateSync()
csA.onSnapshot((s) => syncA.push(s))
csB.onSnapshot((s) => syncB.push(s))

const sm = new ScreenStateMachine()              // 界面层：状态机
sm.transition('inGame')

// ── 对局脚本：A 朝右平射、B 朝左平射，各带仰角让弹道呈重力抛物线 ──
const touchA: TouchState = { moveX: 0.6, aimAngle: -0.12, fire: true, jump: false, jetpack: false, reload: false }
const touchB: TouchState = { moveX: -0.6, aimAngle: Math.PI + 0.12, fire: true, jump: false, jetpack: false, reload: false }

console.log('=== Teeworlds-style PVP · Loopback 本地对局 ===')
for (let i = 0; i < TICKS; i++) {
  csA.sendIntents(mapper.map(touchA))            // 操作 → 意图 → 联机发送
  csB.sendIntents(mapper.map(touchB))
  server.step(DT)                                // 联机层：服务器权威推进 + 广播快照
  syncA.advance(DT); syncB.advance(DT)           // 联机层：插值
  const sa = syncA.interpolated() ?? world.snapshot()
  const sb = syncB.interpolated() ?? world.snapshot()
  presA.render(sa, a.id)                         // 界面层：快照 → HUD
  presB.render(sb, b.id)
  if (i % 30 === 0) {
    console.log(presA.describe(sa, a.id))
    console.log(presB.describe(sb, b.id))
    console.log('')
  }
}

console.log('--- 对局结束 ---')
console.log(`A: K/D=${a.kills}/${a.deaths}   B: K/D=${b.kills}/${b.deaths}`)
console.log(`服务器权威 world: tick=${world.tick}  命中=${world.hits}  存活弹丸=${world.projectiles.length}`)
console.log(`界面状态机: ${sm.current}   HUD(A)=${JSON.stringify(hudA.current)}`)
