// net/transport/Peer.ts —— 真实 P2P 传输：PeerJS DataConnection → Transport 抽象
// 设计要点（合并价值核心）：
//   - 浏览器里 DataConnection 直接包成 ClientTransport/ServerTransport；
//   - 不 import peerjs（避免把库塞进 core/测试），只依赖最小结构接口 → 可在 Node 里用假连接测试。
//   - 协议就是 JSON 序列化的 ClientMsg / ServerMsg（骨架既有协议）。
import type { ClientMsg, ClientTransport, ServerMsg, ServerTransport } from './types.ts'

/** PeerJS `DataConnection` 的最小可用子集（send / on('data') / close） */
export interface PeerConnLike {
  send(data: string): void
  on(event: 'data', cb: (data: unknown) => void): void
  on(event: 'close', cb: () => void): void
  close(): void
}

function parseMsg(raw: unknown): ServerMsg | null {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as ServerMsg } catch { return null }
  }
  if (raw && typeof raw === 'object') return raw as ServerMsg
  return null
}

/** 客户端侧：把一条 DataConnection 包装成 ClientTransport */
export function createPeerClient(conn: PeerConnLike): ClientTransport {
  let onServer: ((m: ServerMsg) => void) | null = null
  conn.on('data', (raw) => {
    const m = parseMsg(raw)
    if (m && 'snap' in m) onServer?.(m)
  })
  return {
    send(m: ClientMsg) { conn.send(JSON.stringify(m)) },
    onServer(cb) { onServer = cb },
  }
}

/** 服务端（主机）侧：把一条 DataConnection 包装成 ServerTransport */
export function createPeerServer(conn: PeerConnLike): ServerTransport {
  let onClient: ((m: ClientMsg) => void) | null = null
  conn.on('data', (raw) => {
    const m = parseMsg(raw) as unknown as ClientMsg | null
    if (m && 'intents' in m) onClient?.(m)
  })
  return {
    send(m: ServerMsg) { conn.send(JSON.stringify(m)) },
    onClient(cb) { onClient = cb },
  }
}

/** 一条连接的双向端点（主机持 server 端、客户端持 client 端） */
export interface PeerPair {
  client: ClientTransport
  server: ServerTransport
}

/** 用一对 `PeerConnLike` 组装出主机/客户端两侧（浏览器与假连接测试共用） */
export function createPeerPair(hostConn: PeerConnLike, guestConn: PeerConnLike): PeerPair {
  return {
    client: createPeerClient(guestConn),
    server: createPeerServer(hostConn),
  }
}