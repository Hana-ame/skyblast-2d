// web/effects.ts —— 客户端粒子特效（纯表现层，不参与权威模拟）
// 百人同场优化：环形覆盖替代 shift()、O(1) Swap-and-Pop 替代 splice(i, 1)，消除高频弹幕下的数组搬移
export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  gravity: number
  fade: boolean
}

const MAX_PARTICLES = 400

export class Effects {
  particles: Particle[] = []
  private overwriteCursor = 0
  private rnd(): number { return Math.random() }

  private push(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) {
      this.particles[this.overwriteCursor] = p
      this.overwriteCursor = (this.overwriteCursor + 1) % MAX_PARTICLES
    } else {
      this.particles.push(p)
    }
  }

  /** 爆炸：火球 + 火花 + 烟 */
  explosion(x: number, y: number, radius: number): void {
    const n = Math.min(26, Math.round(radius / 6) + 8)
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2
      const spd = (0.6 + this.rnd() * 2.2) * (radius / 60)
      this.push({
        x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 0.6,
        life: 24 + this.rnd() * 22, maxLife: 46,
        size: 2 + this.rnd() * 4,
        color: this.rnd() > 0.4 ? '#fb923c' : (this.rnd() > 0.5 ? '#fbbf24' : '#ef4444'),
        gravity: 0.05, fade: true,
      })
    }
    for (let i = 0; i < 8; i++) {
      this.push({
        x, y, vx: (this.rnd() - 0.5) * 0.6, vy: -0.4 - this.rnd() * 0.8,
        life: 30 + this.rnd() * 26, maxLife: 56,
        size: 5 + this.rnd() * 8, color: 'rgba(120,130,150,0.55)', gravity: -0.01, fade: true,
      })
    }
  }

  /** 障碍物破坏：碎块 */
  debris(x: number, y: number, w: number, h: number, color: string, border: string): void {
    for (let i = 0; i < 14; i++) {
      this.push({
        x: x + (this.rnd() - 0.5) * w, y: y + (this.rnd() - 0.5) * h,
        vx: (this.rnd() - 0.5) * 4, vy: -1 - this.rnd() * 3,
        life: 26 + this.rnd() * 20, maxLife: 46,
        size: 2 + this.rnd() * 4,
        color: this.rnd() > 0.5 ? color : border,
        gravity: 0.22, fade: true,
      })
    }
  }

  /** 拾取/补给：上升的星光 */
  sparkle(x: number, y: number, color = '#4ade80'): void {
    for (let i = 0; i < 10; i++) {
      this.push({
        x: x + (this.rnd() - 0.5) * 24, y,
        vx: (this.rnd() - 0.5) * 0.6, vy: -1 - this.rnd() * 1.4,
        life: 22 + this.rnd() * 18, maxLife: 40,
        size: 1.5 + this.rnd() * 2.5, color, gravity: -0.02, fade: true,
      })
    }
  }

  /** 枪口火焰 */
  muzzle(x: number, y: number, color: string): void {
    for (let i = 0; i < 4; i++) {
      this.push({
        x, y, vx: (this.rnd() - 0.5) * 1.2, vy: (this.rnd() - 0.5) * 1.2,
        life: 6 + this.rnd() * 6, maxLife: 12,
        size: 2 + this.rnd() * 3, color, gravity: 0, fade: true,
      })
    }
  }

  /** 喷气尾焰 */
  jet(x: number, y: number): void {
    this.push({
      x: x + (this.rnd() - 0.5) * 6, y: y + 8,
      vx: (this.rnd() - 0.5) * 0.5, vy: 1.4 + this.rnd() * 1.6,
      life: 8 + this.rnd() * 8, maxLife: 16,
      size: 2 + this.rnd() * 2.5, color: this.rnd() > 0.5 ? '#7dd3fc' : '#38bdf8',
      gravity: 0.02, fade: true,
    })
  }

  /** 击杀：能量爆散 */
  killBurst(x: number, y: number, color: string): void {
    for (let i = 0; i < 14; i++) {
      const a = this.rnd() * Math.PI * 2
      const spd = 1 + this.rnd() * 3
      this.push({
        x, y: y - 12, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 1,
        life: 18 + this.rnd() * 16, maxLife: 34,
        size: 2 + this.rnd() * 3, color, gravity: 0.08, fade: true,
      })
    }
  }

  update(dt: number): void {
    const k = dt * 60
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= k
      if (p.life <= 0) {
        // O(1) Swap-and-Pop 替代 splice(i, 1)
        const last = this.particles.length - 1
        if (i !== last) this.particles[i] = this.particles[last]
        this.particles.pop()
        if (this.overwriteCursor >= this.particles.length) this.overwriteCursor = 0
        continue
      }
      p.x += p.vx * k
      p.y += p.vy * k
      p.vy += p.gravity * k
      p.vx *= 0.99
    }
  }

  /** 渲染：由调用方提供 世界→屏幕 的偏移函数（相机居中坐标系） */
  render(ctx: CanvasRenderingContext2D, screenOf: (x: number, y: number) => { x: number; y: number }, inView: (x: number, y: number) => boolean): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      const s = screenOf(p.x, p.y)
      if (!inView(s.x, s.y)) continue
      const alpha = p.fade ? Math.max(0, p.life / p.maxLife) : 1
      ctx.globalAlpha = alpha
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(s.x, s.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  clear(): void {
    this.particles.length = 0
    this.overwriteCursor = 0
  }
}