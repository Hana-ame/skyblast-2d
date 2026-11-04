// web/controls.ts —— 手机触屏虚拟手柄 + 桌面键鼠 → TouchState（浏览器，零依赖）
// 统一用【逻辑世界坐标】(0..logicalW, 0..logicalH)，canvas 逻辑坐标 = 世界坐标（1:1）。
// 触屏：左半屏=移动摇杆（横向 → moveX）；右半屏=瞄准（相对玩家）+ 按住开火。
// 桌面：A/D/←→ 移动、W/空格/↑ 跳、E 喷射、R 装填、鼠标瞄准、左键开火。
export interface TouchState {
  moveX: number
  aimAngle: number
  fire: boolean
  jump: boolean
  jetpack: boolean
  reload: boolean
}

export interface ControlsCallbacks {
  onFullscreen?: () => void
}

export class Controls {
  private keys = new Set<string>()
  private mouse = { x: 0, y: 0 }
  private mouseDown = false
  private playerWorld = { x: 0, y: 0 }
  private isTouch: boolean
  private tMoveX = 0
  private tAim = 0
  private tFire = false
  private tJump = false
  private tJetpack = false
  private tReload = false
  private canvas: HTMLCanvasElement
  private logicalW: number
  private logicalH: number

  constructor(canvas: HTMLCanvasElement, logicalW: number, logicalH: number, cb: ControlsCallbacks = {}) {
    this.canvas = canvas
    this.logicalW = logicalW
    this.logicalH = logicalH
    this.isTouch = 'ontouchstart' in window
    window.addEventListener('keydown', (e) => this.onKey(e, true))
    window.addEventListener('keyup', (e) => this.onKey(e, false))
    window.addEventListener('mousemove', (e) => { this.mouse = this.toWorld(e.clientX, e.clientY) })
    window.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouseDown = true })
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false })
    canvas.addEventListener('touchstart', (e) => this.onTouch(e), { passive: false })
    canvas.addEventListener('touchmove', (e) => this.onTouch(e), { passive: false })
    canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false })
    canvas.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false })
  }

  /** 玩家逻辑世界坐标（供瞄准角计算） */
  setPlayerScreen(x: number, y: number): void {
    this.playerWorld = { x, y }
  }

  pressJump(): void { this.tJump = true }
  setJetpack(on: boolean): void { this.tJetpack = on }
  pressReload(): void { this.tReload = true }
  consumeMomentary(): void { this.tJump = false; this.tReload = false }

  getState(): TouchState {
    if (this.isTouch) {
      return { moveX: this.tMoveX, aimAngle: this.tAim, fire: this.tFire, jump: this.tJump, jetpack: this.tJetpack, reload: this.tReload }
    }
    const k = this.keys
    let moveX = 0
    if (k.has('a') || k.has('arrowleft')) moveX -= 1
    if (k.has('d') || k.has('arrowright')) moveX += 1
    const aim = Math.atan2(this.mouse.y - this.playerWorld.y, this.mouse.x - this.playerWorld.x)
    return {
      moveX,
      aimAngle: aim,
      fire: this.mouseDown,
      jump: k.has('w') || k.has(' ') || k.has('arrowup'),
      jetpack: k.has('e'),
      reload: k.has('r'),
    }
  }

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    return {
      x: ((clientX - r.left) / r.width) * this.logicalW,
      y: ((clientY - r.top) / r.height) * this.logicalH,
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase()
    if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'e', 'r'].includes(k)) e.preventDefault()
    if (down) this.keys.add(k)
    else this.keys.delete(k)
  }

  private onTouch(e: TouchEvent): void {
    e.preventDefault()
    const r = this.canvas.getBoundingClientRect()
    for (const t of Array.from(e.changedTouches)) {
      const relX = t.clientX - r.left
      if (relX < r.width / 2) {
        this.tMoveX = Math.max(-1, Math.min(1, (relX / (r.width / 2) - 0.5) * 2))
      } else {
        const w = this.toWorld(t.clientX, t.clientY)
        this.tAim = Math.atan2(w.y - this.playerWorld.y, w.x - this.playerWorld.x)
        this.tFire = true
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    e.preventDefault()
    const r = this.canvas.getBoundingClientRect()
    for (const t of Array.from(e.changedTouches)) {
      const relX = t.clientX - r.left
      if (relX >= r.width / 2) this.tFire = false
      else this.tMoveX = 0
    }
  }
}
