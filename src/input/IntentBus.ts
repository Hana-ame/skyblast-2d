// input/IntentBus.ts —— 操作层：意图发布/订阅（解耦点之一）
import type { Intent } from './intent.ts'

type Listener = (intents: Intent[]) => void

export class IntentBus {
  private listeners = new Set<Listener>()

  publish(intents: Intent[]): void {
    for (const l of this.listeners) l(intents)
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}
