// net/ServerSim.ts —— 联机层：服务器权威（跑 core 世界 + 广播快照 + 追踪 ackSeq 支撑客户端回滚重放）
import type { ServerTransport } from './transport/types.ts'
import type { FastServerTransport } from './transport/Peer.ts'
import { encodeServerWireFrame } from './transport/Peer.ts'
import { filterSnapshotAOI } from './protocol/BinaryCodec.ts'
import type { World } from '../core/sim/world.ts'
import { defaultWorldInput } from '../core/types.ts'
import type { WorldInput, WorldEvent } from '../core/types.ts'
import type { Intent } from '../input/intent.ts'
import type { WorldSnapshot } from '../core/snap.ts'

export interface ServerMsg {
  snap: WorldSnapshot
  events?: WorldEvent[]
}

export interface ServerSimOptions {
  /** 每多少个物理 tick 广播一次快照（默认 1=60Hz；百人联机推荐 3=20Hz） */
  syncEveryTicks?: number
  /** 是否开启 AOI 视野兴趣区弹幕裁剪（默认 false；超多弹幕时开启） */
  enableAOI?: boolean
  aoiRadiusX?: number
  aoiRadiusY?: number
}

export class ServerSim {
  private world: World
  private clients: { id: number; transport: FastServerTransport; input: WorldInput; lastAckSeq: number }[] = []
  private events: WorldEvent[] = []
  private pendingBroadcastEvents: WorldEvent[] = []
  private syncEveryTicks: number
  private enableAOI: boolean
  private aoiRadiusX: number
  private aoiRadiusY: number
  private tickCounter = 0

  constructor(world: World, opts: ServerSimOptions = {}) {
    this.world = world
    this.syncEveryTicks = Math.max(1, opts.syncEveryTicks ?? 1)
    this.enableAOI = opts.enableAOI ?? false
    this.aoiRadiusX = opts.aoiRadiusX ?? 2800
    this.aoiRadiusY = opts.aoiRadiusY ?? 1800
  }

  accept(id: number, transport: ServerTransport): void {
    const client = { id, transport: transport as FastServerTransport, input: defaultWorldInput(), lastAckSeq: 0 }
    transport.onClient((msg) => {
      if (typeof msg.seq === 'number' && msg.seq > client.lastAckSeq) {
        client.lastAckSeq = msg.seq
      }
      client.input = applyIntents(client.input, msg.intents)
    })
    this.clients.push(client)
  }

  removeClient(id: number): void {
    this.clients = this.clients.filter(c => c.id !== id)
  }

  step(dt: number): void {
    this.tickCounter++
    const inputs = new Map<number, WorldInput>()
    for (let i = 0; i < this.clients.length; i++) {
      const c = this.clients[i]
      inputs.set(c.id, c.input)
    }
    this.world.step(dt, inputs)
    // 瞬时意图单发消费（跳跃/交互/副武器/换枪），防止下一 tick 重复触发
    for (let i = 0; i < this.clients.length; i++) {
      const c = this.clients[i]
      c.input.jump = false
      c.input.interact = false
      c.input.secondary = null
      c.input.switchWeapon = null
      c.input.reload = false
    }
    const events = this.world.drainEvents()
    if (events.length > 0) {
      this.events.push(...events)
      this.pendingBroadcastEvents.push(...events)
    }

    if (this.clients.length === 0) {
      this.pendingBroadcastEvents.length = 0
      return
    }

    if (this.tickCounter % this.syncEveryTicks !== 0) return

    const snap = this.world.snapshot()
    // 写入每个客户端的最新已执行输入序列号 ackSeqs，供客户端预测做回滚重放（Reconciliation）
    const ackSeqs: Record<number, number> = {}
    for (let i = 0; i < this.clients.length; i++) {
      const c = this.clients[i]
      ackSeqs[c.id] = c.lastAckSeq
    }
    snap.ackSeqs = ackSeqs

    const outEvents = this.pendingBroadcastEvents.length > 0 ? [...this.pendingBroadcastEvents] : []
    this.pendingBroadcastEvents.length = 0

    if (!this.enableAOI) {
      const msg: ServerMsg = { snap, events: outEvents }
      let sharedWireFrame: Uint8Array | string | null = null
      for (let i = 0; i < this.clients.length; i++) {
        const t = this.clients[i].transport
        if (t.sendRawFrame) {
          if (sharedWireFrame === null) sharedWireFrame = encodeServerWireFrame(msg)
          t.sendRawFrame(sharedWireFrame)
        } else {
          t.send(msg)
        }
      }
    } else {
      for (let i = 0; i < this.clients.length; i++) {
        const c = this.clients[i]
        const clientSnap = filterSnapshotAOI(snap, c.id, this.aoiRadiusX, this.aoiRadiusY)
        c.transport.send({ snap: clientSnap, events: outEvents })
      }
    }
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
  for (let i = 0; i < intents.length; i++) {
    const it = intents[i]
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
