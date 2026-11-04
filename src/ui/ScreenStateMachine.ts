// ui/ScreenStateMachine.ts —— 界面逻辑层：界面状态机（纯逻辑，与玩法/网络解耦）
export type Screen = 'lobby' | 'inGame' | 'scoreboard' | 'result'

export class ScreenStateMachine {
  private cur: Screen = 'lobby'
  private onChange: ((s: Screen) => void) | null = null

  transition(to: Screen): void {
    if (this.cur === to) return
    this.cur = to
    this.onChange?.(to)
  }

  subscribe(cb: (s: Screen) => void): void {
    this.onChange = cb
  }

  get current(): Screen {
    return this.cur
  }
}
