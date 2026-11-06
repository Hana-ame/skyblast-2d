// web/sprites.ts —— 角色/道具 sprite（纯 canvas 矢量绘制，无外部图片资源）
// 所有坐标都是「相机居中坐标系」（已在 renderScene 里做过 scale/translate），
// 传入 dx/dy = 实体相对相机的屏幕偏移；尺寸单位 = 世界像素。
import type { PlayerState, SupplyCrate, AmmoPack, Mortar, Watchtower, WarpPortal, CapturePoint, Landmine, Projectile, Grenade, Airstrike } from '../core/types.ts'
import { WEAPONS } from '../core/weapons.ts'

export interface TeamPalette { color: string; light: string; dark: string }
export const TEAM_PALETTE: Record<string, TeamPalette> = {
  red: { color: '#f43f5e', light: '#fda4af', dark: '#9f1239' },
  blue: { color: '#0ea5e9', light: '#7dd3fc', dark: '#075985' },
  green: { color: '#10b981', light: '#6ee7b7', dark: '#065f46' },
  ffa: { color: '#eab308', light: '#fde047', dark: '#854d0e' },
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** 玩家角色 sprite：腿部动画 + 躯干护甲 + 头盔面罩 + 武器 + 喷气背包火焰 + 护盾 */
export function drawPlayerSprite(ctx: CanvasRenderingContext2D, p: PlayerState, dx: number, dy: number, opts: {
  tick: number
  isLocal: boolean
  movingX: number
  floating: boolean
  mounted: boolean
}): void {
  const pal = TEAM_PALETTE[p.team] ?? TEAM_PALETTE.red
  const wep = WEAPONS[p.weaponIndex] ?? WEAPONS[0]
  const t = opts.tick
  const facing = Math.cos(p.aim) >= 0 ? 1 : -1
  const walkPhase = Math.sin(t * 0.35) * (opts.movingX !== 0 ? 1 : 0)
  const alive = p.alive && p.respawnTimer <= 0

  ctx.save()
  ctx.translate(dx, dy)
  if (!alive) ctx.globalAlpha = 0.45

  // 落地阴影
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(0, 18, 14, 4, 0, 0, Math.PI * 2)
  ctx.fill()

  // 腿（行走摆动）
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(-9 + walkPhase * 3, 8, 6, 10)
  ctx.fillRect(3 - walkPhase * 3, 8, 6, 10)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(-9 + walkPhase * 3, 16, 7, 3)
  ctx.fillRect(2 - walkPhase * 3, 16, 7, 3)

  // 躯干（渐变护甲）
  const bodyGrad = ctx.createLinearGradient(0, -14, 0, 10)
  bodyGrad.addColorStop(0, pal.light)
  bodyGrad.addColorStop(0.45, pal.color)
  bodyGrad.addColorStop(1, pal.dark)
  ctx.fillStyle = bodyGrad
  ctx.strokeStyle = '#0b1220'
  ctx.lineWidth = 2
  roundRect(ctx, -11, -14, 22, 24, 6)
  ctx.fill()
  ctx.stroke()
  // 胸甲高光
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  roundRect(ctx, -7, -11, 6, 8, 2)
  ctx.fill()
  // 队伍臂章
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(4, -6, 4, 4)

  // 喷气背包
  ctx.fillStyle = '#334155'
  roundRect(ctx, facing > 0 ? -15 : 8, -10, 7, 14, 2)
  ctx.fill()
  ctx.fillStyle = '#64748b'
  ctx.fillRect(facing > 0 ? -14 : 9, -8, 5, 3)
  // 火焰（漂浮/喷射时）
  if (opts.floating) {
    const flick = 0.7 + Math.sin(t * 0.9) * 0.3 + Math.random() * 0.15
    const fx = facing > 0 ? -15 : 15
    const grad = ctx.createLinearGradient(fx, 6, fx, 6 + 16 * flick)
    grad.addColorStop(0, 'rgba(125, 211, 252, 0.95)')
    grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.7)')
    grad.addColorStop(1, 'rgba(56, 189, 248, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(fx - 3, 4)
    ctx.lineTo(fx + 3, 4)
    ctx.lineTo(fx + (Math.random() - 0.5) * 2, 4 + 18 * flick)
    ctx.closePath()
    ctx.fill()
  }

  // 头盔/面罩
  ctx.fillStyle = '#cbd5e1'
  ctx.strokeStyle = '#0b1220'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(0, -24, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = pal.dark
  ctx.beginPath()
  ctx.arc(0, -24, 8, 0, Math.PI * 2)
  ctx.fill()
  // 面罩（朝向）
  ctx.fillStyle = '#0ea5e9'
  ctx.fillRect(facing > 0 ? 2 : -8, -26, 6, 3)
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.fillRect(facing > 0 ? 3 : -7, -26, 2, 1)

  // 武器 sprite（按武器类型画不同枪管）
  if (!opts.mounted) {
    ctx.save()
    ctx.rotate(p.aim - (facing < 0 ? Math.PI : 0))
    const flip = facing < 0 ? -1 : 1
    ctx.scale(1, flip)
    const metal = '#1e293b'
    const accent = wep.color
    switch (wep.id) {
      case 0: // 霰弹枪
        ctx.fillStyle = metal
        roundRect(ctx, 6, -9, 26, 7, 2); ctx.fill()
        ctx.fillStyle = '#7c2d12'
        roundRect(ctx, 20, -4, 12, 4, 1); ctx.fill()
        ctx.fillStyle = accent
        ctx.fillRect(10, -8, 8, 2)
        break
      case 1: // 步枪
        ctx.fillStyle = metal
        roundRect(ctx, 6, -9, 30, 6, 2); ctx.fill()
        ctx.fillStyle = '#334155'
        roundRect(ctx, 12, -4, 7, 8, 2); ctx.fill()
        ctx.fillStyle = accent
        ctx.fillRect(8, -8, 14, 2)
        break
      case 2: // 狙击（长枪管 + 瞄准镜）
        ctx.fillStyle = metal
        roundRect(ctx, 6, -9, 42, 5, 2); ctx.fill()
        ctx.fillStyle = '#0f172a'
        roundRect(ctx, 14, -15, 14, 5, 2); ctx.fill()
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.5
        ctx.strokeRect(14, -15, 14, 5)
        break
      case 3: // 榴弹炮（粗管）
        ctx.fillStyle = metal
        roundRect(ctx, 6, -12, 24, 11, 5); ctx.fill()
        ctx.fillStyle = accent
        ctx.fillRect(30, -11, 6, 9)
        break
      case 4: // 激光炮（能量线圈）
        ctx.fillStyle = metal
        roundRect(ctx, 6, -9, 28, 8, 3); ctx.fill()
        ctx.strokeStyle = accent
        ctx.lineWidth = 2
        for (let i = 0; i < 3; i++) {
          ctx.beginPath()
          ctx.arc(12 + i * 8, -5, 3.4, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.fillStyle = 'rgba(34,211,238,0.35)'
        ctx.beginPath()
        ctx.moveTo(36, -5)
        ctx.lineTo(52, -5)
        ctx.strokeStyle = 'rgba(34,211,238,0.55)'
        ctx.stroke()
        break
      case 5: // 加特林（多管）
        ctx.fillStyle = metal
        roundRect(ctx, 6, -12, 22, 13, 4); ctx.fill()
        ctx.fillStyle = '#64748b'
        for (let i = 0; i < 3; i++) ctx.fillRect(26, -11 + i * 4, 10, 2.4)
        break
      case 6: // 引力枪（环形发射器）
        ctx.fillStyle = metal
        roundRect(ctx, 6, -10, 20, 9, 4); ctx.fill()
        ctx.strokeStyle = accent
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(30, -5.5, 6, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = 'rgba(168,85,247,0.35)'
        ctx.beginPath(); ctx.arc(30, -5.5, 4, 0, Math.PI * 2); ctx.fill()
        break
    }
    ctx.restore()
  }

  // 护盾
  if (p.shieldTimer > 0 && p.shieldHp > 0) {
    ctx.strokeStyle = 'rgba(56,189,248,0.9)'
    ctx.fillStyle = 'rgba(56,189,248,0.14)'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(0, -8, 30 + Math.sin(t * 0.15) * 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  ctx.restore()
}

/** 玩家头顶 UI：名字 / 血条 / 子弹数 / 本机标记（在 sprite 之后单独画，避免被缩放影响） */
export function drawPlayerTag(ctx: CanvasRenderingContext2D, p: PlayerState, dx: number, dy: number, isLocal: boolean): void {
  if (!p.alive || p.respawnTimer > 0) return
  const pal = TEAM_PALETTE[p.team] ?? TEAM_PALETTE.red
  const wep = WEAPONS[p.weaponIndex] ?? WEAPONS[0]
  ctx.save()
  ctx.translate(dx, dy)
  // 名字
  ctx.font = 'bold 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = isLocal ? '#f8fafc' : pal.light
  ctx.fillText((isLocal ? '▶ ' : '') + p.name, 0, -46)
  // 血条
  const barW = 44
  ctx.fillStyle = 'rgba(15,23,42,0.85)'
  ctx.fillRect(-barW / 2, -42, barW, 5)
  const ratio = Math.max(0, p.hp) / p.maxHp
  ctx.fillStyle = ratio > 0.4 ? (p.team === 'red' ? '#f43f5e' : p.team === 'blue' ? '#0ea5e9' : p.team === 'green' ? '#10b981' : '#eab308') : '#ef4444'
  ctx.fillRect(-barW / 2, -42, barW * ratio, 5)
  // 护盾条
  if (p.shieldTimer > 0 && p.shieldHp > 0) {
    ctx.fillStyle = 'rgba(15,23,42,0.85)'
    ctx.fillRect(-barW / 2, -36, barW, 3)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(-barW / 2, -36, barW * Math.min(1, p.shieldHp / 130), 3)
  }
  // 弹药小字
  ctx.font = '9px Inter, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(226,232,240,0.75)'
  ctx.fillText(`${wep.shortName} ${p.ammo[p.weaponIndex] ?? 0}`, 0, -50)
  ctx.restore()
}

/** 可破坏障碍物：按类型上纹理感（砖/沙袋/掩体箱） + 血条 */
export function drawObstacleSprite(ctx: CanvasRenderingContext2D, ob: { x: number; y: number; w: number; h: number; hp: number; maxHp: number; color: string; borderColor: string; label: string }, dx: number, dy: number): void {
  const left = dx - ob.w / 2
  const top = dy - ob.h / 2
  ctx.save()
  // 底色
  ctx.fillStyle = ob.color
  ctx.fillRect(left, top, ob.w, ob.h)
  // 斜纹/砖块纹
  const ratio = ob.hp / ob.maxHp
  ctx.strokeStyle = ob.borderColor
  ctx.lineWidth = 2
  ctx.strokeRect(left + 1, top + 1, ob.w - 2, ob.h - 2)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(left + 2, top + 2, ob.w - 4, 3)
  for (let y = top + 10; y < top + ob.h - 4; y += 12) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(left + 2, y, ob.w - 4, 1)
  }
  // 受损裂纹（hp 越低越多）
  if (ratio < 0.66) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = 1
    const cracks = ratio < 0.33 ? 4 : 2
    for (let i = 0; i < cracks; i++) {
      ctx.beginPath()
      let x = left + ob.w * (0.2 + 0.6 * ((i * 37) % 10) / 10)
      let y = top + ob.h * 0.15
      ctx.moveTo(x, y)
      for (let k = 0; k < 4; k++) {
        x += ((i % 2 === 0 ? 1 : -1) * 4)
        y += ob.h / 5
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  // 血条
  const barW = Math.max(40, ob.w)
  ctx.fillStyle = 'rgba(15,23,42,0.85)'
  ctx.fillRect(dx - barW / 2, top - 10, barW, 5)
  ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#f59e0b' : '#ef4444'
  ctx.fillRect(dx - barW / 2, top - 10, barW * ratio, 5)
  ctx.restore()
}

/** 补给箱 sprite */
export function drawCrateSprite(ctx: CanvasRenderingContext2D, crate: SupplyCrate, dx: number, dy: number, tick: number): void {
  ctx.save()
  ctx.translate(dx, dy - 18)
  const bob = Math.sin(tick * 0.08 + crate.x * 0.01) * 1.5
  ctx.translate(0, bob)
  // 箱体
  const grad = ctx.createLinearGradient(0, -16, 0, 16)
  if (crate.kind === 'doll') {
    grad.addColorStop(0, '#831843')
    grad.addColorStop(1, '#4a1d3a')
  } else {
    grad.addColorStop(0, '#312e81')
    grad.addColorStop(1, '#1e1b4b')
  }
  ctx.fillStyle = grad
  ctx.strokeStyle = crate.color
  ctx.lineWidth = 2.5
  roundRect(ctx, -18, -16, 36, 32, 5)
  ctx.fill()
  ctx.stroke()
  // 箱盖
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  roundRect(ctx, -16, -14, 32, 10, 3)
  ctx.fill()
  // 锁扣
  ctx.fillStyle = crate.color
  ctx.fillRect(-3, -3, 6, 8)
  // 图标/标签
  ctx.font = 'bold 12px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = crate.color
  ctx.fillText(crate.kind === 'doll' ? '🎎' : '🎁', 0, 3)
  ctx.font = 'bold 10px Inter, system-ui, sans-serif'
  ctx.fillStyle = crate.color
  ctx.fillText(crate.kind === 'doll' ? '替身人偶' : crate.weaponName, 0, -22)
  // 刷新计时
  if (!crate.active && crate.respawnTimer > 0) {
    ctx.fillStyle = 'rgba(148,163,184,0.7)'
    ctx.font = '9px Inter, system-ui, sans-serif'
    ctx.fillText(`${Math.ceil(crate.respawnTimer)}s`, 0, 24)
  }
  ctx.restore()
}

/** 弹药点 sprite */
export function drawAmmoSprite(ctx: CanvasRenderingContext2D, pack: AmmoPack, dx: number, dy: number, tick: number): void {
  ctx.save()
  ctx.translate(dx, dy - 16 + Math.sin(tick * 0.09 + pack.x * 0.01) * 1.2)
  ctx.fillStyle = '#14532d'
  ctx.strokeStyle = '#4ade80'
  ctx.lineWidth = 2
  roundRect(ctx, -14, -12, 28, 24, 3)
  ctx.fill()
  ctx.stroke()
  // 弹带
  ctx.fillStyle = '#86efac'
  for (let i = 0; i < 3; i++) ctx.fillRect(-10 + i * 7, -8, 4, 6)
  // 标签
  ctx.font = 'bold 9px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#bbf7d0'
  ctx.fillText('📦 弹药', 0, 20)
  ctx.restore()
}

/** 公共迫击炮 sprite（炮管按 m.angle 旋转） */
export function drawMortarSprite(ctx: CanvasRenderingContext2D, m: Mortar, dx: number, dy: number, tick: number): void {
  ctx.save()
  ctx.translate(dx, dy)
  // 底座
  ctx.fillStyle = '#334155'
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(0, 2, 22, 9, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // 轮子
  ctx.fillStyle = '#1e293b'
  ctx.beginPath(); ctx.arc(-14, 2, 7, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(14, 2, 7, 0, Math.PI * 2); ctx.fill()
  // 炮管
  ctx.save()
  ctx.translate(0, -10)
  ctx.rotate(m.angle)
  const g = ctx.createLinearGradient(0, -7, 0, 7)
  g.addColorStop(0, '#64748b')
  g.addColorStop(0.5, '#475569')
  g.addColorStop(1, '#1e293b')
  ctx.fillStyle = g
  ctx.strokeStyle = m.operatorId ? '#fde047' : '#f97316'
  ctx.lineWidth = 2
  roundRect(ctx, 0, -7, 40, 14, 5)
  ctx.fill()
  ctx.stroke()
  // 炮口
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(36, -8, 6, 16)
  ctx.restore()
  // 状态文字
  ctx.font = 'bold 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = m.operatorId ? '#fde047' : '#fb923c'
  ctx.fillText(m.operatorId ? '🎯 操控中 [E 离开]' : '🔥 迫击炮 [E]', 0, -36)
  if (m.cooldown > 0) {
    ctx.fillStyle = 'rgba(148,163,184,0.6)'
    ctx.font = '9px Inter, system-ui, sans-serif'
    ctx.fillText(`装填 ${m.cooldown.toFixed(1)}s`, 0, -26)
  }
  ctx.restore()
}

/** 瞭望塔 sprite */
export function drawTowerSprite(ctx: CanvasRenderingContext2D, tw: Watchtower, dx: number, dy: number, tick: number): void {
  const h = 150
  ctx.save()
  ctx.translate(dx, dy)
  ctx.strokeStyle = '#a16207'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(-24, 0); ctx.lineTo(-12, -h); ctx.moveTo(24, 0); ctx.lineTo(12, -h)
  ctx.stroke()
  // 交叉桁架
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(202, 138, 4, 0.6)'
  for (let i = 0; i < 5; i++) {
    const y1 = -i * (h / 5)
    const y2 = -(i + 1) * (h / 5)
    const w1 = 24 - (12 * i) / 5
    const w2 = 24 - (12 * (i + 1)) / 5
    ctx.beginPath()
    ctx.moveTo(-w1, y1); ctx.lineTo(w2, y2)
    ctx.moveTo(w1, y1); ctx.lineTo(-w2, y2)
    ctx.stroke()
  }
  // 平台 + 灯塔
  ctx.fillStyle = '#422006'
  ctx.fillRect(-16, -h - 12, 32, 8)
  ctx.fillStyle = '#eab308'
  ctx.fillRect(-6, -h - 26, 12, 14)
  const glow = 0.5 + Math.sin(tick * 0.08) * 0.3
  ctx.fillStyle = `rgba(250, 204, 21, ${glow})`
  ctx.beginPath(); ctx.arc(0, -h - 20, 10 + Math.sin(tick * 0.08) * 2, 0, Math.PI * 2); ctx.fill()
  // 标签
  ctx.font = 'bold 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#fef08a'
  ctx.fillText(`🗼 ${tw.name} [E]`, 0, -h - 34)
  ctx.restore()
}

/** 量子传送门 sprite（旋转光环） */
export function drawWarpSprite(ctx: CanvasRenderingContext2D, wp: WarpPortal, dx: number, dy: number, tick: number): void {
  ctx.save()
  ctx.translate(dx, dy - 28)
  const pulse = 0.5 + Math.sin(tick * 0.1 + wp.x * 0.01) * 0.2
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.9)'
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.ellipse(0, 0, 22 + pulse * 3, 34 + pulse * 4, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = `rgba(6, 182, 212, ${0.12 + pulse * 0.12})`
  ctx.fill()
  // 内部旋涡
  ctx.save()
  ctx.rotate(tick * 0.05)
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.55)'
  ctx.lineWidth = 2
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.ellipse(0, 0, 8 + i * 4, 14 + i * 5, Math.PI / 3, 0, Math.PI * 1.4)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = '#67e8f9'
  ctx.font = 'bold 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`🌀 ${wp.name} [E]`, 0, -48)
  ctx.restore()
}

/** 占领点旗帜 sprite（旗面随 tick 飘动） */
export function drawFlagSprite(ctx: CanvasRenderingContext2D, cp: CapturePoint, dx: number, dy: number, tick: number): void {
  const pal = cp.ownerTeam ? (TEAM_PALETTE[cp.ownerTeam] ?? TEAM_PALETTE.red) : { color: '#94a3b8', light: '#cbd5e1', dark: '#475569' }
  ctx.save()
  ctx.translate(dx, dy)
  // 旗杆
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -100); ctx.stroke()
  // 旗面（贝塞尔 + 波峰）
  const wave = Math.sin(tick * 0.07) * 8
  const wave2 = Math.sin(tick * 0.07 + 1.2) * 4
  ctx.fillStyle = pal.color
  ctx.beginPath()
  ctx.moveTo(0, -100)
  ctx.bezierCurveTo(30, -96 + wave, 46, -88 + wave2, 58, -78 + wave * 0.6)
  ctx.lineTo(58, -46 + wave * 0.6)
  ctx.bezierCurveTo(40, -52 + wave2, 22, -54 + wave, 0, -58)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // 据点文字
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 12px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`🚩 [${cp.code}] ${Math.round(cp.progress)}%`, 0, -112)
  ctx.restore()
}

/** 地雷 sprite */
export function drawMineSprite(ctx: CanvasRenderingContext2D, m: Landmine, dx: number, dy: number, tick: number, triggerRadius: number): void {
  ctx.save()
  ctx.translate(dx, dy)
  const blink = Math.floor(tick / 8) % 2 === 0
  // 感应圈
  ctx.strokeStyle = m.triggered ? 'rgba(244,63,94,0.8)' : m.instant ? 'rgba(56,189,248,0.35)' : 'rgba(244,63,94,0.2)'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.arc(0, 0, triggerRadius, 0, Math.PI * 2); ctx.stroke()
  // 雷体
  const g = ctx.createRadialGradient(-3, -6, 2, 0, 0, 12)
  g.addColorStop(0, m.instant ? '#38bdf8' : '#64748b')
  g.addColorStop(1, m.instant ? '#075985' : '#1e293b')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0, 0, 12, Math.PI, 0); ctx.fill()
  ctx.fillRect(-12, 0, 24, 4)
  // 支脚
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-10, 4); ctx.lineTo(-16, 10)
  ctx.moveTo(10, 4); ctx.lineTo(16, 10)
  ctx.stroke()
  // LED
  ctx.fillStyle = blink ? (m.triggered ? '#ef4444' : m.instant ? '#38bdf8' : '#fbbf24') : '#1e293b'
  ctx.beginPath(); ctx.arc(0, -5, 3.2, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

/** 手雷 sprite */
export function drawGrenadeSprite(ctx: CanvasRenderingContext2D, g: Grenade, dx: number, dy: number, tick: number): void {
  ctx.save()
  ctx.translate(dx, dy)
  ctx.rotate(tick * 0.2)
  const grad = ctx.createRadialGradient(-2, -2, 1, 0, 0, 8)
  grad.addColorStop(0, '#86efac')
  grad.addColorStop(1, '#166534')
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = '#fbbf24'
  ctx.fillRect(-2, -10, 4, 4)
  ctx.restore()
}

/** 空袭信标 sprite */
export function drawAirstrikeSprite(ctx: CanvasRenderingContext2D, st: Airstrike, dx: number, dy: number, tick: number): void {
  ctx.save()
  ctx.translate(dx, dy)
  const pulse = 0.5 + Math.sin(tick * 0.4) * 0.5
  ctx.strokeStyle = `rgba(239,68,68,${0.5 + pulse * 0.4})`
  ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.arc(0, 0, 18 + pulse * 6, 0, Math.PI * 2); ctx.stroke()
  // 垂直光柱
  const beamGrad = ctx.createLinearGradient(0, -400, 0, 0)
  beamGrad.addColorStop(0, 'rgba(239,68,68,0)')
  beamGrad.addColorStop(1, `rgba(239,68,68,${0.35 + pulse * 0.2})`)
  ctx.fillStyle = beamGrad
  ctx.fillRect(-8, -400, 16, 400)
  ctx.fillStyle = '#fecaca'
  ctx.font = 'bold 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`✈️ 空袭 ${st.timer.toFixed(1)}s`, 0, -52)
  ctx.restore()
}

/** 弹丸 sprite：光束 / 曳光弹 / 引力球 */
export function drawProjectileSprite(ctx: CanvasRenderingContext2D, pr: Projectile, dx: number, dy: number, tick: number): void {
  if (pr.beam) {
    const spd = Math.hypot(pr.vel.x, pr.vel.y) || 1
    const len = 150
    const ex = dx - (pr.vel.x / spd) * len
    const ey = dy - (pr.vel.y / spd) * len
    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = pr.color || '#22d3ee'
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(dx, dy); ctx.stroke()
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(dx, dy); ctx.stroke()
    ctx.globalAlpha = 0.5
    ctx.fillStyle = pr.color || '#22d3ee'
    ctx.beginPath(); ctx.arc(dx, dy, 7, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  } else if (pr.isGravityOrb) {
    ctx.save()
    const grd = ctx.createRadialGradient(dx, dy, 2, dx, dy, 24)
    grd.addColorStop(0, 'rgba(216,180,254,0.95)')
    grd.addColorStop(0.4, 'rgba(168,85,247,0.6)')
    grd.addColorStop(1, 'rgba(168,85,247,0)')
    ctx.fillStyle = grd
    ctx.beginPath(); ctx.arc(dx, dy, 24, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#e9d5ff'
    ctx.beginPath(); ctx.arc(dx, dy, pr.r, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  } else {
    const spd = Math.hypot(pr.vel.x, pr.vel.y) || 1
    const len = 14
    const ex = dx - (pr.vel.x / spd) * len
    const ey = dy - (pr.vel.y / spd) * len
    ctx.save()
    ctx.strokeStyle = pr.color || '#fbbf24'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(dx, dy); ctx.stroke()
    ctx.fillStyle = '#fff7d6'
    ctx.beginPath(); ctx.arc(dx, dy, Math.max(1.5, pr.r - 1), 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
}