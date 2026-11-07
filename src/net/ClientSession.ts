// net/ClientSession.ts —— 联机层：客户端会话（发送意图流 + 维护未确认输入环形缓冲 + 接收快照与事件）
// 补齐 DESIGN.md 规划的 Client-Side Prediction & Reconciliation：
//   - sendIntents 时将 (seq, dt, WorldInput) 压入环形缓冲区，并立即驱动绑定 StateSync 做 0 延迟本地预测
//   - 收到服务器快照时根据 snap.ackSeqs[playerId] 清理已确认输入，并将剩余未确认输入交给 StateSync 回滚重放
import type { ClientTransport } from './transport/types.ts'
import type { Intent } from '../input/intent.ts'
import type { WorldSnapshot } from '../core/snap.ts'
import { defaultWorldInput } from '../core/types.ts'
import type { WorldEvent, WorldInput } from '../core/types.ts'
import { applyIntents } from './ServerSim.ts'
import type { StateSync, PendingInputFrame } from './StateSync.ts'

const MAX_PENDING_INPUTS = 128

export class ClientSession {
  private transport: ClientTransport
  playerId: number   // 联机时由服务器 welcome 下发；Loopback 测试直接构造
  private seq = 0
  private cb: ((s: WorldSnapshot) => void) | null = null
  private evCb: ((e: WorldEvent[]) => void) | null = null
  private stateSync: StateSync | null = null
  private currentInput: WorldInput = defaultWorldInput()
  readonly pendingInputs: PendingInputFrame[] = []
  lastAckSeq = 0
  lastSnapshot: WorldSnapshot | null = null
  lastEvents: WorldEvent[] = []

  constructor(transport: ClientTransport, playerId: number, stateSync?: StateSync) {
    this.transport = transport
    this.playerId = playerId
    if (stateSync) this.bindStateSync(stateSync)
    transport.onServer((m) => {
      if (m.welcome) {
        this.playerId = m.welcome.playerId
        if (this.stateSync) this.stateSync.setLocalPlayerId(this.playerId)
      }
      const ack = m.snap.ackSeqs?.[this.playerId]
      if (ack !== undefined && ack > this.lastAckSeq) {
        this.lastAckSeq = ack
        // 移除所有已被服务器确认的输入帧
        let dropCount = 0
        while (dropCount < this.pendingInputs.length && this.pendingInputs[dropCount].seq <= ack) {
          dropCount++
        }
        if (dropCount > 0) this.pendingInputs.splice(0, dropCount)
      }
      if (this.stateSync) {
        this.stateSync.push(m.snap, this.playerId, this.pendingInputs, m.events)
      }
      this.lastSnapshot = m.snap
      this.lastEvents = m.events ?? []
      this.cb?.(m.snap)
      this.evCb?.(this.lastEvents)
    })
  }

  /** 绑定 StateSync：开启本地玩家 0 延迟预测与收到快照后的自动回滚重放 */
  bindStateSync(sync: StateSync): void {
    this.stateSync = sync
    if (this.playerId > 0) sync.setLocalPlayerId(this.playerId)
  }

  sendIntents(intents: Intent[], dt = 1 / 60): number {
    const seq = ++this.seq
    this.currentInput = applyIntents(this.currentInput, intents)
    const frameInput: WorldInput = {
      ...this.currentInput,
      secondary: this.currentInput.secondary ? { ...this.currentInput.secondary } : null,
    }
    const frame: PendingInputFrame = { seq, dt, input: frameInput }
    if (this.pendingInputs.length >= MAX_PENDING_INPUTS) {
      this.pendingInputs.shift()
    }
    this.pendingInputs.push(frame)

    // 瞬时意图单发消费，避免本地下一帧重复触发
    this.currentInput.jump = false
    this.currentInput.interact = false
    this.currentInput.secondary = null
    this.currentInput.switchWeapon = null
    this.currentInput.reload = false

    // 本地立即预测执行（0 RTT 等待）
    if (this.stateSync && this.playerId > 0) {
      this.stateSync.applyLocalInput(frameInput, dt)
    }

    this.transport.send({ seq, ts: Date.now(), intents })
    return seq
  }

  onSnapshot(cb: (s: WorldSnapshot) => void): void {
    this.cb = cb
  }

  onEvents(cb: (e: WorldEvent[]) => void): void {
    this.evCb = cb
  }
}
