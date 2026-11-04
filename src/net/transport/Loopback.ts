// net/transport/Loopback.ts —— 环回传输：本机客户端↔服务器同步直连（测试/单机）
import type { ClientMsg, ClientTransport, ServerMsg, ServerTransport } from './types.ts'

export interface LoopbackPair {
  client: ClientTransport
  server: ServerTransport
}

export function createLoopback(): LoopbackPair {
  let serverOnClient: ((m: ClientMsg) => void) | null = null
  let clientOnServer: ((m: ServerMsg) => void) | null = null
  return {
    client: {
      send: (m) => serverOnClient?.(m),
      onServer: (cb) => { clientOnServer = cb },
    },
    server: {
      send: (m) => clientOnServer?.(m),
      onClient: (cb) => { serverOnClient = cb },
    },
  }
}
