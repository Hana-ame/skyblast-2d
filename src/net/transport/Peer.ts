// net/transport/Peer.ts —— 真实 P2P 传输：PeerJS DataConnection → Transport 抽象
// 升级：默认启用 SkyBlast 2D 私有二进制协议（SB2B/SB2C），支持：
//   1. 原生 Uint8Array 零拷贝二进制帧广播（百人房间主机只编码 1 次，直接向 100 个连接复用发送同一二进制 Buffer）
//   2. 自动嗅探解包：同时兼容 Uint8Array / ArrayBuffer / "\x00SB2:" 紧凑帧 / 旧版 JSON 字符串
import type { ClientMsg, ClientTransport, ServerMsg, ServerTransport } from './types.ts'
import {
  encodeServerMsgBinary, decodeServerMsgBinary,
  encodeClientMsgBinary, decodeClientMsgBinary,
  frameStringToBytes, BINARY_STR_PREFIX,
} from '../protocol/BinaryCodec.ts'

/** PeerJS `DataConnection` 的最小可用子集（send / on('data') / close） */
export interface PeerConnLike {
  send(data: string): void
  on(event: 'data', cb: (data: unknown) => void): void
  on(event: 'close', cb: () => void): void
  close(): void
}

/** 扩展的 ServerTransport：支持直接发送预编码二进制帧（避免百人房间重复序列化 100 次） */
export interface FastServerTransport extends ServerTransport {
  sendRawFrame?(frame: Uint8Array | string): void
}

export function encodeServerWireFrame(m: ServerMsg): Uint8Array {
  return encodeServerMsgBinary(m)
}

export function encodeClientWireFrame(m: ClientMsg): Uint8Array {
  return encodeClientMsgBinary(m)
}

function parseServerMsg(raw: unknown): ServerMsg | null {
  if (raw instanceof Uint8Array) return decodeServerMsgBinary(raw)
  if (raw instanceof ArrayBuffer) return decodeServerMsgBinary(new Uint8Array(raw))
  if (typeof raw === 'string') {
    if (raw.startsWith(BINARY_STR_PREFIX)) {
      return decodeServerMsgBinary(frameStringToBytes(raw))
    }
    try { return JSON.parse(raw) as ServerMsg } catch { return null }
  }
  if (raw && typeof raw === 'object') return raw as ServerMsg
  return null
}

function parseClientMsg(raw: unknown): ClientMsg | null {
  if (raw instanceof Uint8Array) return decodeClientMsgBinary(raw)
  if (raw instanceof ArrayBuffer) return decodeClientMsgBinary(new Uint8Array(raw))
  if (typeof raw === 'string') {
    if (raw.startsWith(BINARY_STR_PREFIX)) {
      return decodeClientMsgBinary(frameStringToBytes(raw))
    }
    try { return JSON.parse(raw) as ClientMsg } catch { return null }
  }
  if (raw && typeof raw === 'object') return raw as ClientMsg
  return null
}

/** 客户端侧：把一条 DataConnection 包装成 ClientTransport（默认使用 SB2C 私有二进制协议） */
export function createPeerClient(conn: PeerConnLike): ClientTransport {
  let onServer: ((m: ServerMsg) => void) | null = null
  conn.on('data', (raw) => {
    const m = parseServerMsg(raw)
    if (m && 'snap' in m) onServer?.(m)
  })
  return {
    send(m: ClientMsg) { conn.send(encodeClientWireFrame(m) as unknown as string) },
    onServer(cb) { onServer = cb },
  }
}

/** 服务端（主机）侧：把一条 DataConnection 包装成 FastServerTransport（默认使用 SB2S 私有二进制协议） */
export function createPeerServer(conn: PeerConnLike): FastServerTransport {
  let onClient: ((m: ClientMsg) => void) | null = null
  conn.on('data', (raw) => {
    const m = parseClientMsg(raw)
    if (m && 'intents' in m) onClient?.(m)
  })
  return {
    send(m: ServerMsg) { conn.send(encodeServerWireFrame(m) as unknown as string) },
    sendRawFrame(frame: Uint8Array | string) { conn.send(frame as unknown as string) },
    onClient(cb) { onClient = cb },
  }
}

/** 一条连接的双向端点（主机持 server 端、客户端持 client 端） */
export interface PeerPair {
  client: ClientTransport
  server: FastServerTransport
}

/** 用一对 `PeerConnLike` 组装出主机/客户端两侧（浏览器与假连接测试共用） */
export function createPeerPair(hostConn: PeerConnLike, guestConn: PeerConnLike): PeerPair {
  return {
    client: createPeerClient(guestConn),
    server: createPeerServer(hostConn),
  }
}
