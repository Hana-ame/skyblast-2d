// net/ClientSession.ts —— 联机层：客户端会话（发送意图流 / 接收快照）
import type { ClientTransport } from './transport/types.ts'
import type { Intent } from '../input/intent.ts'
import type { WorldSnapshot } from '../core/types.ts'

export class ClientSession {
  private transport: ClientTransport
  playerId: number
  private seq = 0
  private cb: ((s: WorldSnapshot) => void) | null = null
  lastSnapshot: WorldSnapshot | null = null

  constructor(transport: ClientTransport, playerId: number) {
    this.transport = transport
    this.playerId = playerId
    transport.onServer((m) => {
      this.lastSnapshot = m.snap
      this.cb?.(m.snap)
    })
  }

  sendIntents(intents: Intent[]): void {
    this.transport.send({ seq: ++this.seq, ts: Date.now(), intents })
  }

  onSnapshot(cb: (s: WorldSnapshot) => void): void {
    this.cb = cb
  }
}
