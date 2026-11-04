// net/transport/types.ts —— 联机层对外传输抽象（可替换：WebRTC/UDP/Loopback）
import type { Intent } from '../../input/intent.ts'
import type { WorldSnapshot } from '../../core/types.ts'

export interface ClientMsg { seq: number; ts: number; intents: Intent[] }
export interface ServerMsg { snap: WorldSnapshot }

export interface ClientTransport {
  send(m: ClientMsg): void
  onServer(cb: (m: ServerMsg) => void): void
}

export interface ServerTransport {
  send(m: ServerMsg): void
  onClient(cb: (m: ClientMsg) => void): void
}
