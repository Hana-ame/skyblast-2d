// net/transport/types.ts —— 联机层对外传输抽象（可替换：WebRTC/UDP/Loopback）
import type { Intent } from '../../input/intent.ts'
import type { WorldSnapshot } from '../../core/snap.ts'
import type { WorldEvent } from '../../core/types.ts'

export interface ClientMsg { seq: number; ts: number; intents: Intent[] }
export interface ServerMsg {
  snap: WorldSnapshot
  events?: WorldEvent[]
  /** 主机在连接建立时下发的分配信息（客户端据此得知自己的玩家 id） */
  welcome?: { playerId: number; name: string; team: string }
}

export interface ClientTransport {
  send(m: ClientMsg): void
  onServer(cb: (m: ServerMsg) => void): void
}

export interface ServerTransport {
  send(m: ServerMsg): void
  onClient(cb: (m: ClientMsg) => void): void
}
