// net/ClientSession.ts —— 联机层：客户端会话（发送意图流 / 接收快照+事件）
import type { ClientTransport, ServerMsg } from './transport/types.ts'
import type { Intent } from '../input/intent.ts'
import type { WorldSnapshot } from '../core/snap.ts'
import type { WorldEvent } from '../core/types.ts'

export class ClientSession {
  private transport: ClientTransport
  playerId: number   // 联机时由服务器 welcome 下发；Loopback 测试直接构造
  private seq = 0
  private cb: ((s: WorldSnapshot) => void) | null = null
  private evCb: ((e: WorldEvent[]) => void) | null = null
  lastSnapshot: WorldSnapshot | null = null
  lastEvents: WorldEvent[] = []

  constructor(transport: ClientTransport, playerId: number) {
    this.transport = transport
    this.playerId = playerId
    transport.onServer((m) => {
      if (m.welcome) this.playerId = m.welcome.playerId
      this.lastSnapshot = m.snap
      this.lastEvents = m.events ?? []
      this.cb?.(m.snap)
      this.evCb?.(this.lastEvents)
    })
  }

  sendIntents(intents: Intent[]): void {
    this.transport.send({ seq: ++this.seq, ts: Date.now(), intents })
  }

  onSnapshot(cb: (s: WorldSnapshot) => void): void {
    this.cb = cb
  }

  onEvents(cb: (e: WorldEvent[]) => void): void {
    this.evCb = cb
  }
}
