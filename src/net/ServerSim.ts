// net/ServerSim.ts —— 联机层：服务器权威（跑 core 世界 + 广播快照）
// 合并改造：新意图合并（interact/secondary/switchWeapon 全部瞬时单发消费）；
// 快照带事件流（killfeed/音效），事件只广播不重放。
import type { ServerTransport } from './transport/types.ts'
import type { World } from '../core/sim/world.ts'
import { defaultWorldInput } from '../core/types.ts'
import type { WorldInput, WorldEvent } from '../core/types.ts'
import type { Intent } from '../input/intent.ts'
import type { WorldSnapshot } from '../core/snap.ts'

export interface ServerMsg {
  snap: WorldSnapshot
  events?: WorldEvent[]
}

export class ServerSim {
  private world: World
  private clients: { id: number; transport: ServerTransport; input: WorldInput }[] = []
  private events: WorldEvent[] = []

  constructor(world: World) {
    this.world = world
  }

  accept(id: number, transport: ServerTransport): void {
    const client = { id, transport, input: defaultWorldInput() }
    transport.onClient((msg) => { client.input = applyIntents(client.input, msg.intents) })
    this.clients.push(client)
  }

  step(dt: number): void {
    const inputs = new Map<number, WorldInput>()
    for (const c of this.clients) inputs.set(c.id, c.input)
    this.world.step(dt, inputs)
    // 瞬时意图单发消费（跳跃/交互/副武器/换枪），防止下一 tick 重复触发
    for (const c of this.clients) {
      c.input.jump = false
      c.input.interact = false
      c.input.secondary = null
      c.input.switchWeapon = null
      c.input.reload = false
    }
    const events = this.world.drainEvents()
    this.events.push(...events)
    const snap = this.world.snapshot()
    const msg: ServerMsg = { snap, events }
    for (const c of this.clients) c.transport.send(msg)
  }

  /** 取走累计事件（net/ui 层订阅 killfeed/音效用） */
  drainEvents(): WorldEvent[] {
    const out = this.events
    this.events = []
    return out
  }
}

export function applyIntents(cur: WorldInput, intents: Intent[]): WorldInput {
  const n = { ...cur }
  for (const it of intents) {
    switch (it.t) {
      case 'move': n.move = it.dir; break
      case 'jump': n.jump = true; break
      case 'jetpack': n.jetpack = it.on; break
      case 'dive': n.dive = it.on; break
      case 'aim': n.aim = it.angle; break
      case 'fire': n.fire = it.on; break
      case 'reload': n.reload = true; break
      case 'interact': n.interact = true; break
      case 'secondary': n.secondary = { type: it.kind, targetX: it.targetX, targetY: it.targetY }; break
      case 'switchWeapon': n.switchWeapon = it.index; break
    }
  }
  return n
}
