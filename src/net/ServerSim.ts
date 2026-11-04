// net/ServerSim.ts —— 联机层：服务器权威（跑 core 世界 + 广播快照）
import type { ServerTransport } from './transport/types.ts'
import type { World } from '../core/sim/world.ts'
import { defaultWorldInput } from '../core/types.ts'
import type { WorldInput } from '../core/types.ts'
import type { Intent } from '../input/intent.ts'

export class ServerSim {
  private world: World
  private clients: { id: number; transport: ServerTransport; input: WorldInput }[] = []

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
    // 瞬时意图（跳跃）单发消费，防止落地后连跳
    for (const c of this.clients) c.input.jump = false
    const snap = this.world.snapshot()
    for (const c of this.clients) c.transport.send({ snap })
  }
}

function applyIntents(cur: WorldInput, intents: Intent[]): WorldInput {
  const n = { ...cur }
  for (const it of intents) {
    switch (it.t) {
      case 'move': n.move = it.dir; break
      case 'jump': n.jump = true; break
      case 'jetpack': n.jetpack = it.on; break
      case 'aim': n.aim = it.angle; break
      case 'fire': n.fire = it.on; break
      case 'reload': break
    }
  }
  return n
}
