// web/sprites.ts —— 角色/武器/设施/弹道高精度矢量贴图（纯 Canvas 2D 过程式精绘，零外部图片依赖）
// 所有坐标都是「相机居中坐标系」（已在 renderScene 里做过 scale/translate），
// 传入 dx/dy = 实体相对相机的屏幕偏移；尺寸单位 = 世界像素。
import type {
  PlayerState, SupplyCrate, AmmoPack, Mortar, Watchtower, WarpPortal,
  CapturePoint, Landmine, Projectile, Grenade, Airstrike,
} from '../core/types.ts'
import { WEAPONS, DEFAULT_CONFIG } from '../core/weapons.ts'
import { getPhysicsParams } from '../core/sim/physics.ts'

export interface TeamPalette { color: string; light: string; dark: string; glow: string }
export const TEAM_PALETTE: Record<string, TeamPalette> = {
  red:   { color: '#f43f5e', light: '#fda4af', dark: '#881337', glow: 'rgba(244,63,94,0.35)' },
  blue:  { color: '#0ea5e9', light: '#7dd3fc', dark: '#0c4a6e', glow: 'rgba(14,165,233,0.35)' },
  green: { color: '#10b981', light: '#6ee7b7', dark: '#064e3b', glow: 'rgba(16,185,129,0.35)' },
  ffa:   { color: '#eab308', light: '#fde047', dark: '#713f12', glow: 'rgba(234,179,8,0.35)' },
}

let cachedShadowGrad: CanvasGradient | null = null
const cachedBodyGrads = new Map<string, CanvasGradient>()
const cachedHelmGrads = new Map<number, CanvasGradient>()
const cachedVisorGrads = new Map<number, CanvasGradient>()
let cachedShieldGrad: CanvasGradient | null = null
let cachedJetFlameGrad: CanvasGradient | null = null
let cachedCrateGlowDoll: CanvasGradient | null = null
let cachedCrateGlowWep: CanvasGradient | null = null
let cachedCrateGradDoll: CanvasGradient | null = null
let cachedCrateGradWep: CanvasGradient | null = null
let cachedAmmoGrad: CanvasGradient | null = null
let cachedMortarBarrelGrad: CanvasGradient | null = null
let cachedMineGradInstant: CanvasGradient | null = null
let cachedMineGradNormal: CanvasGradient | null = null
let cachedGrenadeGrad: CanvasGradient | null = null
let cachedAirstrikeBeamGrad: CanvasGradient | null = null
let cachedRocketFlameGrad: CanvasGradient | null = null
let cachedRocketBodyGrad: CanvasGradient | null = null
let cachedGravOrbGrad: CanvasGradient | null = null
let cachedDecoLampGrad: CanvasGradient | null = null
const cachedDecoWindowGrads = new Map<number, CanvasGradient>()
const cachedDecoBarrelGrads = new Map<number, CanvasGradient>()
const cachedDecoPipeGrads = new Map<number, CanvasGradient>()
let cachedJumpPadGlowGrad: CanvasGradient | null = null

const RIVET_OFFSETS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const

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

/** 玩家角色精绘贴图：战术护腿 + 装甲躯干 + 反应堆胸灯 + 双喷口背包与等离子尾焰 + 战术头盔面罩 + 9 把全系列精细武器 + 能量护盾 */
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

  // 1. 落地软阴影（缓存本地坐标渐变，消除每帧每角色重复创建）
  if (!cachedShadowGrad) {
    cachedShadowGrad = ctx.createRadialGradient(0, 18, 2, 0, 18, 16)
    cachedShadowGrad.addColorStop(0, 'rgba(0,0,0,0.45)')
    cachedShadowGrad.addColorStop(1, 'rgba(0,0,0,0)')
  }
  ctx.fillStyle = cachedShadowGrad
  ctx.beginPath()
  ctx.ellipse(0, 18, 16, 4.5, 0, 0, Math.PI * 2)
  ctx.fill()

  // 2. 喷气背包（画在躯干后层，带燃料指示条与双喷嘴等离子尾焰）
  const packX = facing > 0 ? -16 : 9
  const nozzleX = facing > 0 ? -12.5 : 12.5
  ctx.fillStyle = '#1e293b'
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 1.5
  roundRect(ctx, packX, -12, 7.5, 16, 2.5)
  ctx.fill()
  ctx.stroke()
  // 背包金属高光与横向加固箍
  ctx.fillStyle = '#475569'
  ctx.fillRect(packX + 1, -10, 5.5, 3)
  ctx.fillRect(packX + 1, -2, 5.5, 2)
  // 背包侧燃料液位条
  const fuelMax = Math.max(0.1, getPhysicsParams().jetpackFuel * (wep.fuelMult ?? 1))
  const fuelRatio = Math.max(0, Math.min(1, p.fuel / fuelMax))
  ctx.fillStyle = '#090d16'
  ctx.fillRect(packX + 2.2, -6, 3, 8)
  ctx.fillStyle = fuelRatio > 0.3 ? '#38bdf8' : '#f97316'
  ctx.fillRect(packX + 2.2, -6 + 8 * (1 - fuelRatio), 3, 8 * fuelRatio)
  // 喷嘴
  ctx.fillStyle = '#334155'
  ctx.fillRect(nozzleX - 2.5, 3.5, 5, 3)

  // 喷气尾焰（外层电离蓝 + 内层炽白激波，复用缓存渐变）
  if (opts.floating) {
    const flick = 0.78 + Math.sin(t * 0.95) * 0.22 + Math.cos(t * 1.7) * 0.1
    const outerLen = 20 * flick
    if (!cachedJetFlameGrad) {
      cachedJetFlameGrad = ctx.createLinearGradient(0, 6, 0, 28)
      cachedJetFlameGrad.addColorStop(0, 'rgba(56, 189, 248, 0.95)')
      cachedJetFlameGrad.addColorStop(0.55, 'rgba(14, 165, 233, 0.65)')
      cachedJetFlameGrad.addColorStop(1, 'rgba(2, 132, 199, 0)')
    }
    ctx.fillStyle = cachedJetFlameGrad
    ctx.beginPath()
    ctx.moveTo(nozzleX - 4, 6)
    ctx.lineTo(nozzleX + 4, 6)
    ctx.lineTo(nozzleX + Math.sin(t * 1.3) * 1.5, 6 + outerLen)
    ctx.closePath()
    ctx.fill()

    // 内层炽白激波核心
    const innerLen = 11 * flick
    ctx.fillStyle = 'rgba(224, 242, 254, 0.92)'
    ctx.beginPath()
    ctx.moveTo(nozzleX - 2, 6)
    ctx.lineTo(nozzleX + 2, 6)
    ctx.lineTo(nozzleX, 6 + innerLen)
    ctx.closePath()
    ctx.fill()
  }

  // 3. 腿部与战术战靴（行走摆动 + 护膝）
  const leftLegX = -9 + walkPhase * 3.2
  const rightLegX = 3 - walkPhase * 3.2
  ctx.fillStyle = '#1e293b'
  roundRect(ctx, leftLegX, 7, 6, 10, 1.5); ctx.fill()
  roundRect(ctx, rightLegX, 7, 6, 10, 1.5); ctx.fill()
  // 护膝（队伍暗色）
  ctx.fillStyle = pal.dark
  ctx.fillRect(leftLegX + 0.5, 9, 5, 3)
  ctx.fillRect(rightLegX + 0.5, 9, 5, 3)
  // 战靴
  ctx.fillStyle = '#0f172a'
  roundRect(ctx, leftLegX - 0.5, 15.5, 7.5, 3.5, 1.2); ctx.fill()
  roundRect(ctx, rightLegX - 0.5, 15.5, 7.5, 3.5, 1.2); ctx.fill()

  // 4. 躯干装甲（按队伍缓存本地坐标渐变 + 战术腰带 + 核心指示灯）
  let bodyGrad = cachedBodyGrads.get(pal.color)
  if (!bodyGrad) {
    bodyGrad = ctx.createLinearGradient(0, -14, 0, 10)
    bodyGrad.addColorStop(0, pal.light)
    bodyGrad.addColorStop(0.4, pal.color)
    bodyGrad.addColorStop(1, pal.dark)
    cachedBodyGrads.set(pal.color, bodyGrad)
  }
  ctx.fillStyle = bodyGrad
  ctx.strokeStyle = '#090d16'
  ctx.lineWidth = 2
  roundRect(ctx, -11, -14, 22, 23, 6)
  ctx.fill()
  ctx.stroke()

  // 胸甲立体分缝与高光
  ctx.fillStyle = 'rgba(255,255,255,0.26)'
  roundRect(ctx, -8, -11.5, 7, 7, 2)
  ctx.fill()
  // 胸口能量核心（随武器颜色微光）
  ctx.fillStyle = wep.color
  ctx.beginPath()
  ctx.arc(facing * 3, -5, 2.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 0.8
  ctx.stroke()

  // 战术腰带与手雷挂包
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(-10.5, 4.5, 21, 3.5)
  ctx.fillStyle = '#94a3b8'
  ctx.fillRect(-2.5, 5, 5, 2.5)
  if (p.fragCharges > 0) {
    ctx.fillStyle = '#22c55e'
    ctx.beginPath()
    ctx.arc(facing > 0 ? -6 : 6, 6.2, 2.2, 0, Math.PI * 2)
    ctx.fill()
  }

  // 5. 头盔与光学面罩（按朝向缓存渐变）
  let helmGrad = cachedHelmGrads.get(facing)
  if (!helmGrad) {
    helmGrad = ctx.createRadialGradient(-2 * facing, -27, 1, 0, -24, 11)
    helmGrad.addColorStop(0, '#f1f5f9')
    helmGrad.addColorStop(0.55, '#cbd5e1')
    helmGrad.addColorStop(1, '#475569')
    cachedHelmGrads.set(facing, helmGrad)
  }
  ctx.fillStyle = helmGrad
  ctx.strokeStyle = '#090d16'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(0, -24, 10.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // 头盔顶部队伍涂装带
  ctx.fillStyle = pal.color
  ctx.beginPath()
  ctx.arc(0, -24, 8.2, Math.PI * 1.15, Math.PI * 1.85)
  ctx.fill()

  // 战术耳麦短天线
  const antX = facing > 0 ? -6 : 6
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(antX, -28)
  ctx.lineTo(antX - facing * 2, -35)
  ctx.stroke()
  ctx.fillStyle = pal.light
  ctx.beginPath()
  ctx.arc(antX - facing * 2, -35, 1.3, 0, Math.PI * 2)
  ctx.fill()

  // 光学面罩（按朝向缓存渐变）
  const visorX = facing > 0 ? 1.5 : -9
  let visorGrad = cachedVisorGrads.get(facing)
  if (!visorGrad) {
    visorGrad = ctx.createLinearGradient(visorX, -27, visorX + 7.5, -22)
    visorGrad.addColorStop(0, '#38bdf8')
    visorGrad.addColorStop(0.6, '#0284c7')
    visorGrad.addColorStop(1, '#0f172a')
    cachedVisorGrads.set(facing, visorGrad)
  }
  ctx.fillStyle = visorGrad
  roundRect(ctx, visorX, -26.8, 7.5, 4.2, 1.5)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(visorX + (facing > 0 ? 1.5 : 4), -26, 2.2, 1.2)

  // 6. 全系列 9 把武器精绘贴图（id 0..8 完整覆盖）
  if (!opts.mounted) {
    ctx.save()
    // 武器朝向修正：朝左时必须用 rotate(aim + PI) + scale(-1, 1)。
    // 原实现是 rotate(aim - PI) + scale(1, -1)：canvas 变换为后乘
    // (CTM = R(aim-PI)·S(1,-1))，把武器局部 +x 方向映射成 aim+PI，
    // 即枪口与瞄准方向**正好相反**（dot = -1），表现为"瞄准左半边时枪口朝右"。
    // 改为 R(aim+PI)·S(-1,1) 后：局部 +x -> (-r cos(aim+PI), -r sin(aim+PI))
    // = (r cos aim, r sin aim)，与瞄准方向精确一致（dot = +1）。
    ctx.rotate(p.aim + (facing < 0 ? Math.PI : 0))
    const flip = facing < 0 ? -1 : 1
    ctx.scale(flip, 1)
    const metalDark = '#0f172a'
    const metalMid = '#1e293b'
    const metalLight = '#475569'
    const accent = wep.color

    switch (wep.id) {
      case 0: { // 霰弹枪：重型泵动式，胡桃木护木 + 散热孔 + 侧置黄铜弹夹条
        ctx.fillStyle = '#7c2d12'
        roundRect(ctx, 2, -6, 8, 5, 1.5); ctx.fill()
        ctx.fillStyle = metalMid
        roundRect(ctx, 8, -9.5, 26, 6.5, 2); ctx.fill()
        ctx.fillStyle = metalLight
        ctx.fillRect(14, -9.5, 18, 2)
        ctx.fillStyle = '#9a3412'
        roundRect(ctx, 18, -4, 12, 4.2, 1.5); ctx.fill()
        ctx.strokeStyle = '#431407'
        ctx.lineWidth = 1
        for (let gx = 20; gx <= 28; gx += 2.5) {
          ctx.beginPath(); ctx.moveTo(gx, -4); ctx.lineTo(gx, 0); ctx.stroke()
        }
        ctx.fillStyle = accent
        for (let sx = 10; sx <= 16; sx += 2.5) ctx.fillRect(sx, -7.5, 1.6, 3)
        ctx.fillStyle = metalDark
        ctx.fillRect(33, -9, 3, 5.5)
        break
      }
      case 1: { // 突击步枪：战术导轨卡宾枪 + 全息瞄具 + 弧形弹匣 + 制退器
        ctx.fillStyle = metalDark
        roundRect(ctx, 1, -7.5, 7, 5, 1.2); ctx.fill()
        ctx.fillStyle = metalMid
        roundRect(ctx, 7, -9.5, 25, 6.5, 2); ctx.fill()
        ctx.fillStyle = metalLight
        ctx.fillRect(31, -8, 7, 3)
        ctx.fillStyle = metalDark
        ctx.fillRect(37, -8.8, 3, 4.6)
        ctx.fillStyle = '#334155'
        ctx.beginPath()
        ctx.moveTo(14, -3)
        ctx.lineTo(20, -3)
        ctx.lineTo(22, 5.5)
        ctx.lineTo(16, 5.5)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = metalDark
        roundRect(ctx, 11, -13, 7, 3.8, 1); ctx.fill()
        ctx.fillStyle = accent
        ctx.fillRect(13, -12, 3, 1.8)
        ctx.fillStyle = accent
        ctx.fillRect(9, -7.5, 18, 1.8)
        break
      }
      case 2: { // 狙击步枪：反器材修长浮置枪管 + 双室制退器 + 高倍紫晶瞄准镜 + 折叠脚架
        ctx.fillStyle = metalDark
        roundRect(ctx, 0, -8, 9, 6, 1.5); ctx.fill()
        ctx.fillStyle = metalMid
        roundRect(ctx, 8, -9.5, 18, 6, 2); ctx.fill()
        ctx.fillStyle = '#334155'
        ctx.fillRect(25, -8.2, 22, 3.2)
        ctx.fillStyle = metalDark
        ctx.beginPath()
        ctx.moveTo(46, -10.5)
        ctx.lineTo(51, -8.5)
        ctx.lineTo(51, -4.5)
        ctx.lineTo(46, -2.5)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = metalDark
        roundRect(ctx, 11, -15.5, 16, 4.8, 1.5); ctx.fill()
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.3
        ctx.strokeRect(11, -15.5, 16, 4.8)
        ctx.fillStyle = accent
        ctx.fillRect(25, -14.8, 2, 3.4)
        if (p.chargeTimer > 0) {
          const cr = Math.min(1, p.chargeTimer / (wep.chargeSeconds ?? 0.6))
          ctx.fillStyle = `rgba(192, 132, 252, ${0.35 + 0.6 * cr})`
          ctx.fillRect(9, -7.2, 36 * cr, 1.8)
        }
        break
      }
      case 3: { // 火箭筒：重型肩扛发射筒 + 尾部喇叭喷口 + 外露高爆弹头 + 警示斜纹
        ctx.fillStyle = metalDark
        ctx.beginPath()
        ctx.moveTo(-4, -12.5)
        ctx.lineTo(4, -10)
        ctx.lineTo(4, -2)
        ctx.lineTo(-4, 0.5)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#1e293b'
        roundRect(ctx, 3, -12, 27, 11, 4); ctx.fill()
        ctx.strokeStyle = '#0f172a'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = '#475569'
        ctx.fillRect(10, -12, 3, 11)
        ctx.fillRect(22, -12, 3, 11)
        ctx.fillStyle = '#fbbf24'
        ctx.fillRect(15, -11, 5, 2)
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.moveTo(29, -11)
        ctx.lineTo(37, -6.5)
        ctx.lineTo(29, -2)
        ctx.closePath()
        ctx.fill()
        break
      }
      case 4: { // 高斯枪：双轨磁道炮 + 3 级脉冲电磁线圈 + 青色等离子核心
        ctx.fillStyle = metalMid
        roundRect(ctx, 4, -10.5, 24, 9, 3); ctx.fill()
        ctx.fillStyle = '#334155'
        ctx.fillRect(26, -10, 14, 2.5)
        ctx.fillRect(26, -4.5, 14, 2.5)
        const coilPulse = 0.65 + 0.35 * Math.sin(t * 0.25)
        ctx.fillStyle = `rgba(34, 211, 238, ${0.45 + 0.35 * coilPulse})`
        ctx.fillRect(8, -7.2, 31, 2.4)
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.8
        for (let i = 0; i < 3; i++) {
          ctx.beginPath()
          ctx.arc(12 + i * 8, -6, 3.6, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.fillStyle = '#a5f3fc'
        ctx.beginPath()
        ctx.arc(40, -6, 2.4, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      case 5: { // M249：重型班用机枪 + 多孔散热护筒 + 下挂大容量弹链箱 + 黄铜弹链
        ctx.fillStyle = metalMid
        roundRect(ctx, 4, -11.5, 22, 10, 3); ctx.fill()
        ctx.fillStyle = '#14532d'
        ctx.strokeStyle = '#052e16'
        ctx.lineWidth = 1.2
        roundRect(ctx, 11, -2, 10, 8, 2); ctx.fill(); ctx.stroke()
        ctx.fillStyle = accent
        for (let bx = 13; bx <= 18; bx += 2) ctx.fillRect(bx, -4, 1.4, 3)
        ctx.fillStyle = '#64748b'
        ctx.fillRect(25, -10.5, 13, 3)
        ctx.fillStyle = '#334155'
        ctx.fillRect(25, -6.5, 15, 2.8)
        ctx.fillStyle = accent
        ctx.fillRect(39, -10.5, 2.5, 6.8)
        break
      }
      case 6: { // 引力枪：奇点发生器 + 弧形束缚爪 + 旋转黑洞视界球
        ctx.fillStyle = metalMid
        roundRect(ctx, 5, -10, 20, 9, 4); ctx.fill()
        ctx.fillStyle = accent
        ctx.fillRect(8, -7, 13, 3)
        ctx.strokeStyle = '#94a3b8'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(29, -5.5, 6.5, -Math.PI * 0.7, -Math.PI * 0.15)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(29, -5.5, 6.5, Math.PI * 0.15, Math.PI * 0.7)
        ctx.stroke()
        const orbPulse = 0.8 + 0.2 * Math.sin(t * 0.2)
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.arc(31, -5.5, 4.5 * orbPulse, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#090414'
        ctx.beginPath()
        ctx.arc(31, -5.5, 2.8, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      case 7: { // 手枪：紧凑型战术手枪 + 金属套筒 + 氚光准星 + 下挂激光指示器
        ctx.fillStyle = metalDark
        ctx.beginPath()
        ctx.moveTo(7, -5)
        ctx.lineTo(12, -5)
        ctx.lineTo(10, 3)
        ctx.lineTo(5.5, 3)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = metalLight
        roundRect(ctx, 6, -9.5, 16, 5, 1.5); ctx.fill()
        ctx.strokeStyle = metalDark
        ctx.lineWidth = 1.2
        ctx.stroke()
        ctx.fillStyle = accent
        ctx.fillRect(8, -8.2, 10, 1.5)
        ctx.fillRect(20, -10.5, 2, 1.5)
        ctx.fillStyle = '#334155'
        ctx.fillRect(15, -4.5, 5, 2.2)
        break
      }
      case 8: { // 冲锋枪：高射速 PDW 冲锋枪 + 散热孔套筒 + 加长弧形弹匣 + 垂直前握把
        ctx.fillStyle = metalMid
        roundRect(ctx, 6, -9.5, 21, 6.5, 2); ctx.fill()
        ctx.fillStyle = metalDark
        roundRect(ctx, 26, -8.5, 6, 4.2, 1.2); ctx.fill()
        ctx.fillStyle = metalDark
        ctx.fillRect(21, -3, 3.2, 5.5)
        ctx.fillStyle = '#334155'
        ctx.beginPath()
        ctx.moveTo(13, -3)
        ctx.lineTo(17, -3)
        ctx.lineTo(19, 6.5)
        ctx.lineTo(15, 6.5)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = accent
        ctx.fillRect(8, -8, 16, 1.8)
        break
      }
    }
    ctx.restore()
  }

  // 7. 能量护盾（缓存径向渐变）
  if (p.shieldTimer > 0 && p.shieldHp > 0) {
    const r = 34 + Math.sin(t * 0.15) * 1.5
    if (!cachedShieldGrad) {
      cachedShieldGrad = ctx.createRadialGradient(0, -8, 13.6, 0, -8, 35)
      cachedShieldGrad.addColorStop(0, 'rgba(56,189,248,0.04)')
      cachedShieldGrad.addColorStop(0.75, 'rgba(56,189,248,0.16)')
      cachedShieldGrad.addColorStop(1, 'rgba(125,211,252,0.42)')
    }
    ctx.fillStyle = cachedShieldGrad
    ctx.strokeStyle = 'rgba(56,189,248,0.92)'
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.arc(0, -8, r, 0, Math.PI * 2)
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
  ctx.font = 'bold 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = isLocal ? '#f8fafc' : pal.light
  ctx.fillText((isLocal ? '▶ ' : '') + p.name, 0, -46)
  const barW = 44
  ctx.fillStyle = 'rgba(15,23,42,0.88)'
  roundRect(ctx, -barW / 2 - 1, -43, barW + 2, 6, 2)
  ctx.fill()
  const ratio = Math.max(0, Math.min(1, p.hp / p.maxHp))
  ctx.fillStyle = ratio > 0.4 ? pal.color : '#ef4444'
  if (ratio > 0) {
    roundRect(ctx, -barW / 2, -42, barW * ratio, 4, 1.5)
    ctx.fill()
  }
  if (p.shieldTimer > 0 && p.shieldHp > 0) {
    ctx.fillStyle = 'rgba(15,23,42,0.85)'
    ctx.fillRect(-barW / 2, -36, barW, 3)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(-barW / 2, -36, barW * Math.min(1, p.shieldHp / DEFAULT_CONFIG.shieldHp), 3)
  }
  ctx.font = '9px Inter, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(226,232,240,0.8)'
  ctx.fillText(`${wep.shortName} ${Math.ceil(p.ammo[p.weaponIndex] ?? 0)}`, 0, -56)
  ctx.restore()
}

/** 可破坏障碍物精绘贴图：装甲金属角铁 + 立体阴影 + 受损裂纹演进 + 血条 */
export function drawObstacleSprite(
  ctx: CanvasRenderingContext2D,
  ob: { x: number; y: number; w: number; h: number; hp: number; maxHp: number; color: string; borderColor: string; label: string; kind?: string },
  dx: number,
  dy: number,
): void {
  const left = dx - ob.w / 2
  const top = dy - ob.h / 2
  const ratio = Math.max(0, Math.min(1, ob.hp / ob.maxHp))
  ctx.save()

  ctx.fillStyle = ob.color
  roundRect(ctx, left, top, ob.w, ob.h, 3)
  ctx.fill()

  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(left + 2, top + 2, ob.w - 4, 4)
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(left + 2, top + ob.h - 5, ob.w - 4, 3)

  if (ob.kind === 'box') {
    ctx.strokeStyle = 'rgba(15,23,42,0.32)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(left + 5, top + 5); ctx.lineTo(left + ob.w - 5, top + ob.h - 5)
    ctx.moveTo(left + ob.w - 5, top + 5); ctx.lineTo(left + 5, top + ob.h - 5)
    ctx.stroke()
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.2)'
    for (let y = top + 10; y < top + ob.h - 4; y += 11) {
      ctx.fillRect(left + 2, y, ob.w - 4, 1.5)
    }
  }

  ctx.strokeStyle = ob.borderColor
  ctx.lineWidth = 2
  roundRect(ctx, left + 1, top + 1, ob.w - 2, ob.h - 2, 3)
  ctx.stroke()

  ctx.fillStyle = 'rgba(226,232,240,0.45)'
  const pad = 4.5
  const innerW = ob.w - pad * 2
  const innerH = ob.h - pad * 2
  for (let i = 0; i < 4; i++) {
    const rx = left + pad + RIVET_OFFSETS[i][0] * innerW
    const ry = top + pad + RIVET_OFFSETS[i][1] * innerH
    ctx.beginPath(); ctx.arc(rx, ry, 1.4, 0, Math.PI * 2); ctx.fill()
  }

  if (ratio < 0.7) {
    ctx.strokeStyle = 'rgba(9,13,22,0.68)'
    ctx.lineWidth = ratio < 0.35 ? 1.6 : 1.1
    const cracks = ratio < 0.35 ? 4 : 2
    for (let i = 0; i < cracks; i++) {
      ctx.beginPath()
      let x = left + ob.w * (0.2 + 0.6 * ((i * 37) % 10) / 10)
      let y = top + ob.h * 0.15
      ctx.moveTo(x, y)
      for (let k = 0; k < 4; k++) {
        x += (i % 2 === 0 ? 1 : -1) * 4
        y += ob.h / 5
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  const barW = Math.max(40, ob.w)
  ctx.fillStyle = 'rgba(15,23,42,0.85)'
  ctx.fillRect(dx - barW / 2, top - 10, barW, 5)
  ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#f59e0b' : '#ef4444'
  ctx.fillRect(dx - barW / 2, top - 10, barW * ratio, 5)
  ctx.restore()
}

/** 补给箱精绘贴图：全息底座光环 + 科幻空投装甲箱 + 霓虹护角 + 悬浮标签 */
export function drawCrateSprite(ctx: CanvasRenderingContext2D, crate: SupplyCrate, dx: number, dy: number, tick: number): void {
  ctx.save()
  ctx.translate(dx, dy - 18)
  const bob = Math.sin(tick * 0.08 + crate.x * 0.01) * 1.8
  ctx.translate(0, bob)

  if (crate.active) {
    if (crate.kind === 'doll') {
      if (!cachedCrateGlowDoll) {
        cachedCrateGlowDoll = ctx.createRadialGradient(0, 14, 2, 0, 14, 26)
        cachedCrateGlowDoll.addColorStop(0, 'rgba(244,114,182,0.35)')
        cachedCrateGlowDoll.addColorStop(1, 'rgba(0,0,0,0)')
      }
      ctx.fillStyle = cachedCrateGlowDoll
    } else {
      if (!cachedCrateGlowWep) {
        cachedCrateGlowWep = ctx.createRadialGradient(0, 14, 2, 0, 14, 26)
        cachedCrateGlowWep.addColorStop(0, 'rgba(56,189,248,0.32)')
        cachedCrateGlowWep.addColorStop(1, 'rgba(0,0,0,0)')
      }
      ctx.fillStyle = cachedCrateGlowWep
    }
    ctx.beginPath()
    ctx.ellipse(0, 15, 24, 6, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  if (crate.kind === 'doll') {
    if (!cachedCrateGradDoll) {
      cachedCrateGradDoll = ctx.createLinearGradient(0, -16, 0, 16)
      cachedCrateGradDoll.addColorStop(0, '#9d174d')
      cachedCrateGradDoll.addColorStop(1, '#4a044e')
    }
    ctx.fillStyle = cachedCrateGradDoll
  } else {
    if (!cachedCrateGradWep) {
      cachedCrateGradWep = ctx.createLinearGradient(0, -16, 0, 16)
      cachedCrateGradWep.addColorStop(0, '#1e3a8a')
      cachedCrateGradWep.addColorStop(1, '#0f172a')
    }
    ctx.fillStyle = cachedCrateGradWep
  }
  ctx.strokeStyle = crate.color
  ctx.lineWidth = 2.2
  roundRect(ctx, -18, -16, 36, 32, 5)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  roundRect(ctx, -16, -14, 32, 9, 3)
  ctx.fill()

  ctx.fillStyle = '#090d16'
  roundRect(ctx, -5, -4, 10, 10, 2); ctx.fill()
  ctx.fillStyle = crate.color
  roundRect(ctx, -3, -2, 6, 6, 1.5); ctx.fill()

  ctx.font = 'bold 12px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(crate.kind === 'doll' ? '🎎' : '🎁', 0, 4)
  ctx.font = 'bold 10px Inter, system-ui, sans-serif'
  ctx.fillStyle = crate.color
  ctx.fillText(crate.kind === 'doll' ? '替身人偶' : crate.weaponName, 0, -22)

  if (!crate.active && crate.respawnTimer > 0) {
    ctx.fillStyle = 'rgba(148,163,184,0.75)'
    ctx.font = '9px Inter, system-ui, sans-serif'
    ctx.fillText(`${Math.ceil(crate.respawnTimer)}s`, 0, 24)
  }
  ctx.restore()
}

/** 弹药箱精绘贴图：军规金属弹药箱 + 锁扣 + 黄铜子弹排绘 */
export function drawAmmoSprite(ctx: CanvasRenderingContext2D, pack: AmmoPack, dx: number, dy: number, tick: number): void {
  ctx.save()
  ctx.translate(dx, dy - 16 + Math.sin(tick * 0.09 + pack.x * 0.01) * 1.4)

  if (!cachedAmmoGrad) {
    cachedAmmoGrad = ctx.createLinearGradient(0, -12, 0, 12)
    cachedAmmoGrad.addColorStop(0, '#166534')
    cachedAmmoGrad.addColorStop(1, '#052e16')
  }
  ctx.fillStyle = cachedAmmoGrad
  ctx.strokeStyle = '#4ade80'
  ctx.lineWidth = 2
  roundRect(ctx, -15, -12, 30, 24, 3.5)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(-13, -10, 26, 4)

  for (let i = 0; i < 3; i++) {
    const bx = -9 + i * 7
    ctx.fillStyle = '#fbbf24'
    ctx.fillRect(bx, -2, 4, 7)
    ctx.fillStyle = '#fde68a'
    ctx.beginPath()
    ctx.moveTo(bx, -2)
    ctx.lineTo(bx + 2, -6)
    ctx.lineTo(bx + 4, -2)
    ctx.closePath()
    ctx.fill()
  }

  ctx.font = 'bold 9px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#bbf7d0'
  ctx.fillText('📦 弹药', 0, 20)
  ctx.restore()
}

/** 公共迫击炮 sprite（炮管按 m.angle 旋转） */
export function drawMortarSprite(ctx: CanvasRenderingContext2D, m: Mortar, dx: number, dy: number, _tick: number): void {
  ctx.save()
  ctx.translate(dx, dy)
  ctx.fillStyle = '#334155'
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(0, 2, 22, 9, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#1e293b'
  ctx.beginPath(); ctx.arc(-14, 2, 7, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(14, 2, 7, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#94a3b8'
  ctx.beginPath(); ctx.arc(-14, 2, 2.5, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(14, 2, 2.5, 0, Math.PI * 2); ctx.fill()
  ctx.save()
  ctx.translate(0, -10)
  ctx.rotate(m.angle)
  if (!cachedMortarBarrelGrad) {
    cachedMortarBarrelGrad = ctx.createLinearGradient(0, -7, 0, 7)
    cachedMortarBarrelGrad.addColorStop(0, '#94a3b8')
    cachedMortarBarrelGrad.addColorStop(0.5, '#475569')
    cachedMortarBarrelGrad.addColorStop(1, '#1e293b')
  }
  ctx.fillStyle = cachedMortarBarrelGrad
  ctx.strokeStyle = m.operatorId ? '#fde047' : '#f97316'
  ctx.lineWidth = 2
  roundRect(ctx, 0, -7, 40, 14, 5)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(36, -8, 6, 16)
  ctx.restore()
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
  ctx.fillStyle = '#422006'
  ctx.fillRect(-16, -h - 12, 32, 8)
  ctx.fillStyle = '#eab308'
  ctx.fillRect(-6, -h - 26, 12, 14)
  const glow = 0.5 + Math.sin(tick * 0.08) * 0.3
  ctx.fillStyle = `rgba(250, 204, 21, ${glow})`
  ctx.beginPath(); ctx.arc(0, -h - 20, 10 + Math.sin(tick * 0.08) * 2, 0, Math.PI * 2); ctx.fill()
  ctx.font = 'bold 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  if (tw.operatorId !== null) {
    ctx.fillStyle = '#67e8f9'
    ctx.fillText(`🗼 ${tw.name} · 观测中 200%`, 0, -h - 34)
  } else {
    ctx.fillStyle = '#fef08a'
    ctx.fillText(`🗼 ${tw.name} [E]`, 0, -h - 34)
  }
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

export const NEUTRAL_FLAG_PALETTE: TeamPalette = {
  color: '#94a3b8',
  light: '#cbd5e1',
  dark: '#475569',
  glow: 'rgba(148, 163, 184, 0.22)',
}

/** 获取占领点旗帜与地面光圈的统一配色（无论未占领、半截读条中、已占领或已选中，地面光圈与旗面颜色严格一致） */
export function getFlagPalette(cp: CapturePoint): TeamPalette {
  const activeTeam = cp.ownerTeam ?? cp.capturingTeam
  return activeTeam ? (TEAM_PALETTE[activeTeam] ?? TEAM_PALETTE.red) : NEUTRAL_FLAG_PALETTE
}

/** 占领点旗帜 sprite（旗面随 tick 飘动） */
export function drawFlagSprite(ctx: CanvasRenderingContext2D, cp: CapturePoint, dx: number, dy: number, tick: number): void {
  const pal = getFlagPalette(cp)
  ctx.save()
  ctx.translate(dx, dy + 16)
  ctx.fillStyle = '#475569'
  roundRect(ctx, -10, -4, 20, 6, 2); ctx.fill()
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -100); ctx.stroke()
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
  ctx.strokeStyle = m.triggered ? 'rgba(244,63,94,0.8)' : m.instant ? 'rgba(56,189,248,0.35)' : 'rgba(244,63,94,0.2)'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.arc(0, 0, triggerRadius, 0, Math.PI * 2); ctx.stroke()
  if (m.instant) {
    if (!cachedMineGradInstant) {
      cachedMineGradInstant = ctx.createRadialGradient(-3, -6, 2, 0, 0, 12)
      cachedMineGradInstant.addColorStop(0, '#38bdf8')
      cachedMineGradInstant.addColorStop(1, '#075985')
    }
    ctx.fillStyle = cachedMineGradInstant
  } else {
    if (!cachedMineGradNormal) {
      cachedMineGradNormal = ctx.createRadialGradient(-3, -6, 2, 0, 0, 12)
      cachedMineGradNormal.addColorStop(0, '#64748b')
      cachedMineGradNormal.addColorStop(1, '#1e293b')
    }
    ctx.fillStyle = cachedMineGradNormal
  }
  ctx.beginPath(); ctx.arc(0, 0, 12, Math.PI, 0); ctx.fill()
  ctx.fillRect(-12, 0, 24, 4)
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-10, 4); ctx.lineTo(-16, 10)
  ctx.moveTo(10, 4); ctx.lineTo(16, 10)
  ctx.stroke()
  ctx.fillStyle = blink ? (m.triggered ? '#ef4444' : m.instant ? '#38bdf8' : '#fbbf24') : '#1e293b'
  ctx.beginPath(); ctx.arc(0, -5, 3.2, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

/** 手雷 sprite */
export function drawGrenadeSprite(ctx: CanvasRenderingContext2D, _g: Grenade, dx: number, dy: number, tick: number): void {
  ctx.save()
  ctx.translate(dx, dy)
  ctx.rotate(tick * 0.2)
  if (!cachedGrenadeGrad) {
    cachedGrenadeGrad = ctx.createRadialGradient(-2, -2, 1, 0, 0, 8)
    cachedGrenadeGrad.addColorStop(0, '#86efac')
    cachedGrenadeGrad.addColorStop(1, '#166534')
  }
  ctx.fillStyle = cachedGrenadeGrad
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.strokeStyle = 'rgba(5,46,22,0.55)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(-6, 0); ctx.lineTo(6, 0)
  ctx.moveTo(0, -6); ctx.lineTo(0, 6)
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
  if (!cachedAirstrikeBeamGrad) {
    cachedAirstrikeBeamGrad = ctx.createLinearGradient(0, -400, 0, 0)
    cachedAirstrikeBeamGrad.addColorStop(0, 'rgba(239,68,68,0)')
    cachedAirstrikeBeamGrad.addColorStop(1, 'rgba(239,68,68,0.45)')
  }
  ctx.fillStyle = cachedAirstrikeBeamGrad
  ctx.fillRect(-8, -400, 16, 400)
  ctx.fillStyle = '#fecaca'
  ctx.font = 'bold 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`✈️ 空袭 ${st.timer.toFixed(1)}s`, 0, -52)
  ctx.restore()
}

/** 弹丸精绘贴图：火箭弹 / 光束 / 奇点引力球（黑洞核心+旋转吸积盘） / 高速曳光弹 */
export function drawProjectileSprite(ctx: CanvasRenderingContext2D, pr: Projectile, dx: number, dy: number, tick: number): void {
  if (pr.rocket) {
    const ang = Math.atan2(pr.vel.y, pr.vel.x)
    ctx.save()
    ctx.translate(dx, dy)
    ctx.rotate(ang)
    const flame = 12 + Math.sin(tick * 1.4) * 5
    if (!cachedRocketFlameGrad) {
      cachedRocketFlameGrad = ctx.createLinearGradient(-14, 0, -32, 0)
      cachedRocketFlameGrad.addColorStop(0, 'rgba(254, 243, 199, 0.95)')
      cachedRocketFlameGrad.addColorStop(0.45, 'rgba(251, 191, 36, 0.85)')
      cachedRocketFlameGrad.addColorStop(0.8, 'rgba(249, 115, 22, 0.55)')
      cachedRocketFlameGrad.addColorStop(1, 'rgba(249, 115, 22, 0)')
    }
    ctx.fillStyle = cachedRocketFlameGrad
    ctx.beginPath()
    ctx.moveTo(-12, -4.5)
    ctx.lineTo(-12 - flame, 0)
    ctx.lineTo(-12, 4.5)
    ctx.closePath()
    ctx.fill()
    if (!cachedRocketBodyGrad) {
      cachedRocketBodyGrad = ctx.createLinearGradient(0, -6, 0, 6)
      cachedRocketBodyGrad.addColorStop(0, '#fda4af')
      cachedRocketBodyGrad.addColorStop(0.5, '#f43f5e')
      cachedRocketBodyGrad.addColorStop(1, '#9f1239')
    }
    ctx.fillStyle = cachedRocketBodyGrad
    ctx.strokeStyle = '#4c0519'
    ctx.lineWidth = 1.5
    roundRect(ctx, -14, -5, 24, 10, 4)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#fde68a'
    ctx.beginPath()
    ctx.moveTo(10, -5)
    ctx.lineTo(18, 0)
    ctx.lineTo(10, 5)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#9f1239'
    ctx.beginPath(); ctx.moveTo(-14, -5); ctx.lineTo(-18, -9); ctx.lineTo(-10, -5); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(-14, 5); ctx.lineTo(-18, 9); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill()
    ctx.restore()
    return
  }
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
    ctx.translate(dx, dy)
    if (!cachedGravOrbGrad) {
      cachedGravOrbGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 26)
      cachedGravOrbGrad.addColorStop(0, 'rgba(233,213,255,0.95)')
      cachedGravOrbGrad.addColorStop(0.38, 'rgba(168,85,247,0.62)')
      cachedGravOrbGrad.addColorStop(1, 'rgba(168,85,247,0)')
    }
    ctx.fillStyle = cachedGravOrbGrad
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill()

    ctx.save()
    ctx.rotate(tick * 0.14)
    ctx.strokeStyle = 'rgba(216,180,254,0.8)'
    ctx.lineWidth = 1.8
    for (let i = 0; i < 2; i++) {
      ctx.beginPath()
      ctx.arc(0, 0, pr.r + 3.5, i * Math.PI, i * Math.PI + Math.PI * 0.65)
      ctx.stroke()
    }
    ctx.restore()

    ctx.fillStyle = '#090414'
    ctx.strokeStyle = '#e9d5ff'
    ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.arc(0, 0, pr.r * 0.72, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.restore()
  } else {
    const spd = Math.hypot(pr.vel.x, pr.vel.y) || 1
    const isSniper = pr.weaponId === 2
    const len = isSniper ? 28 : 15
    const ex = dx - (pr.vel.x / spd) * len
    const ey = dy - (pr.vel.y / spd) * len
    ctx.save()
    ctx.strokeStyle = pr.color || '#fbbf24'
    ctx.lineWidth = isSniper ? 3 : 2.2
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(dx, dy); ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(dx, dy, Math.max(1.6, pr.r - 0.8), 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
}

/** 装饰层 sprite：窗户灯 / 路灯 / 缆线 / 天线 / 蒸汽口 / 警示条 / 油桶 / 管道 / 梯子 / 标牌 */
export function drawDeco(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number; kind: string; color: string; borderColor?: string }, dx: number, dy: number, tick: number): void {
  const left = dx - r.w / 2
  const top = dy - r.h / 2
  switch (r.kind) {
    case 'deco_window_lit': {
      ctx.save()
      ctx.translate(dx, dy)
      ctx.globalAlpha = 0.9
      ctx.fillStyle = r.color
      ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h)
      ctx.strokeStyle = 'rgba(15,23,42,0.75)'
      ctx.lineWidth = 2
      ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h)
      ctx.beginPath()
      ctx.moveTo(0, -r.h / 2); ctx.lineTo(0, r.h / 2)
      ctx.moveTo(-r.w / 2, 0); ctx.lineTo(r.w / 2, 0)
      ctx.stroke()
      let g = cachedDecoWindowGrads.get(r.w)
      if (!g) {
        g = ctx.createRadialGradient(0, 0, 2, 0, 0, r.w * 1.8)
        g.addColorStop(0, 'rgba(251, 191, 36, 0.16)')
        g.addColorStop(1, 'rgba(251, 191, 36, 0)')
        cachedDecoWindowGrads.set(r.w, g)
      }
      ctx.fillStyle = g
      ctx.fillRect(-r.w * 1.5, -r.h * 1.5, r.w * 3, r.h * 3)
      ctx.restore()
      break
    }
    case 'deco_window_dark':
      ctx.fillStyle = '#0b1220'
      ctx.fillRect(left, top, r.w, r.h)
      ctx.strokeStyle = 'rgba(30,41,59,0.9)'
      ctx.lineWidth = 2
      ctx.strokeRect(left, top, r.w, r.h)
      break
    case 'deco_lamp': {
      ctx.save()
      ctx.translate(dx, top)
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(0, r.h); ctx.lineTo(0, 10); ctx.stroke()
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(-7, 0, 14, 10)
      if (!cachedDecoLampGrad) {
        cachedDecoLampGrad = ctx.createRadialGradient(0, 6, 2, 0, 6, 70)
        cachedDecoLampGrad.addColorStop(0, 'rgba(251,191,36,0.22)')
        cachedDecoLampGrad.addColorStop(1, 'rgba(251,191,36,0)')
      }
      ctx.fillStyle = cachedDecoLampGrad
      ctx.beginPath(); ctx.arc(0, 6, 70, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fde68a'
      ctx.beginPath(); ctx.arc(0, 6, 3.5, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      break
    }
    case 'deco_cable': {
      ctx.save()
      ctx.strokeStyle = 'rgba(100,116,139,0.85)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(left, top)
      ctx.quadraticCurveTo(left + r.w / 2, top + r.h * 1.6, left + r.w, top)
      ctx.stroke()
      ctx.fillStyle = '#94a3b8'
      ctx.beginPath(); ctx.arc(left, top, 3, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(left + r.w, top, 3, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      break
    }
    case 'deco_antenna': {
      ctx.save()
      ctx.strokeStyle = r.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(dx, top + r.h); ctx.lineTo(dx, top + 6)
      ctx.moveTo(dx - 10, top + 16); ctx.lineTo(dx + 10, top + 16)
      ctx.moveTo(dx - 7, top + 26); ctx.lineTo(dx + 7, top + 26)
      ctx.stroke()
      const on = Math.floor(tick / 40) % 2 === 0
      ctx.fillStyle = on ? '#ef4444' : '#7f1d1d'
      ctx.beginPath(); ctx.arc(dx, top + 4, 3.5, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      break
    }
    case 'deco_vent': {
      ctx.save()
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = 2
      ctx.strokeRect(left, top, r.w, r.h)
      ctx.fillStyle = 'rgba(148,163,184,0.35)'
      for (let i = 0; i < 3; i++) {
        const ph = ((tick * 0.4 + i * 12) % 36) / 36
        ctx.globalAlpha = (1 - ph) * 0.5
        ctx.beginPath(); ctx.arc(dx, top - 6 - ph * 26, 5 + ph * 8, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.restore()
      break
    }
    case 'deco_stripe': {
      ctx.save()
      ctx.beginPath()
      ctx.rect(left, top, r.w, r.h)
      ctx.clip()
      ctx.fillStyle = 'rgba(245,158,11,0.55)'
      for (let x = left - r.h; x < left + r.w; x += 14) {
        ctx.beginPath()
        ctx.moveTo(x, top + r.h)
        ctx.lineTo(x + 7, top)
        ctx.lineTo(x + 14, top)
        ctx.lineTo(x + 7, top + r.h)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
      break
    }
    case 'deco_barrel': {
      ctx.save()
      ctx.translate(left, top)
      let g = cachedDecoBarrelGrads.get(r.w)
      if (!g) {
        g = ctx.createLinearGradient(0, 0, r.w, 0)
        g.addColorStop(0, '#92400e')
        g.addColorStop(0.5, '#f59e0b')
        g.addColorStop(1, '#78350f')
        cachedDecoBarrelGrads.set(r.w, g)
      }
      ctx.fillStyle = g
      roundRect(ctx, 0, 0, r.w, r.h, 3)
      ctx.fill()
      ctx.strokeStyle = '#451a03'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, 6, r.w, 2)
      ctx.fillRect(0, r.h - 8, r.w, 2)
      ctx.restore()
      break
    }
    case 'deco_pipe_run': {
      ctx.save()
      ctx.translate(left, top)
      let g = cachedDecoPipeGrads.get(r.h)
      if (!g) {
        g = ctx.createLinearGradient(0, 0, 0, r.h)
        g.addColorStop(0, '#0891b2')
        g.addColorStop(0.5, '#22d3ee')
        g.addColorStop(1, '#0e7490')
        cachedDecoPipeGrads.set(r.h, g)
      }
      ctx.fillStyle = g
      roundRect(ctx, 0, 0, r.w, r.h, 4)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,0.4)'
      for (let x = 40; x < r.w; x += 120) ctx.fillRect(x, -2, 6, r.h + 4)
      ctx.restore()
      break
    }
    case 'deco_ladder': {
      ctx.save()
      ctx.strokeStyle = 'rgba(148,163,184,0.75)'
      ctx.lineWidth = 2
      const x1 = left + 2
      const x2 = left + r.w - 2
      ctx.beginPath(); ctx.moveTo(x1, top); ctx.lineTo(x1, top + r.h); ctx.moveTo(x2, top); ctx.lineTo(x2, top + r.h); ctx.stroke()
      for (let y = top + 12; y < top + r.h; y += 22) {
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke()
      }
      ctx.restore()
      break
    }
    case 'deco_sign': {
      ctx.save()
      ctx.fillStyle = 'rgba(15,23,42,0.9)'
      roundRect(ctx, left, top, r.w, r.h, 4)
      ctx.fill()
      ctx.strokeStyle = r.color
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = r.color
      ctx.font = 'bold 13px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`🚩 ${r.borderColor ?? ''}`, dx, top + r.h / 2 + 1)
      ctx.restore()
      break
    }
    case 'deco_bracket': {
      ctx.save()
      ctx.strokeStyle = 'rgba(34,211,238,0.6)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(dx - 8, top + r.h); ctx.lineTo(dx - 8, top); ctx.lineTo(dx + 8, top); ctx.lineTo(dx + 8, top + r.h)
      ctx.stroke()
      ctx.restore()
      break
    }
    case 'deco_vine': {
      ctx.save()
      ctx.strokeStyle = r.color
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(dx, top)
      const sway = Math.sin(tick * 0.04 + r.x * 0.02) * 4
      ctx.quadraticCurveTo(dx + sway, top + r.h * 0.6, dx + sway * 1.6, top + r.h)
      ctx.stroke()
      ctx.fillStyle = 'rgba(74, 222, 128, 0.65)'
      for (let i = 1; i <= 3; i++) {
        const ly = top + (r.h / 4) * i
        const off = Math.sin(tick * 0.04 + r.x * 0.02 + i) * 3
        ctx.beginPath()
        ctx.ellipse(dx + off, ly, 3.4, 5.2, off > 0 ? 0.6 : -0.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      break
    }
    case 'deco_stalactite': {
      ctx.save()
      ctx.fillStyle = r.color
      ctx.beginPath()
      ctx.moveTo(dx - r.w / 2, top)
      ctx.lineTo(dx + r.w / 2, top)
      ctx.lineTo(dx, top + r.h)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.beginPath()
      ctx.moveTo(dx - r.w / 4, top)
      ctx.lineTo(dx, top)
      ctx.lineTo(dx, top + r.h * 0.7)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      break
    }
    case 'deco_moss': {
      ctx.save()
      ctx.fillStyle = r.color
      ctx.globalAlpha = 0.8
      for (let i = 0; i < 4; i++) {
        ctx.beginPath()
        ctx.arc(left + (r.w / 4) * (i + 0.5), top + r.h * 0.6 + Math.sin(i * 2.1) * 3, r.h * 0.35, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      break
    }
    case 'deco_ruin_arch': {
      ctx.save()
      ctx.strokeStyle = r.color
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.arc(dx, top + r.h, r.w / 2, Math.PI, 0)
      ctx.stroke()
      ctx.fillStyle = 'rgba(15,23,42,0.55)'
      ctx.beginPath()
      ctx.arc(dx, top + r.h, r.w / 2 - 6, Math.PI, 0)
      ctx.fill()
      ctx.restore()
      break
    }
    default:
      ctx.fillStyle = r.color
      ctx.fillRect(left, top, r.w, r.h)
  }
}

/** 弹射跳台 sprite：贴地底座 + 向上箭标 + 呼吸光 */
export function drawJumpPad(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number): void {
  const pulse = 0.65 + 0.35 * Math.sin(tick * 0.12 + x * 0.01)
  ctx.save()
  ctx.translate(x, y)
  if (!cachedJumpPadGlowGrad) {
    cachedJumpPadGlowGrad = ctx.createRadialGradient(0, -8, 3, 0, -8, 46)
    cachedJumpPadGlowGrad.addColorStop(0, 'rgba(56, 189, 248, 0.26)')
    cachedJumpPadGlowGrad.addColorStop(1, 'rgba(56, 189, 248, 0)')
  }
  ctx.fillStyle = cachedJumpPadGlowGrad
  ctx.beginPath(); ctx.arc(0, -8, 46, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#0e7490'
  ctx.strokeStyle = '#22d3ee'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(-26, -12, 52, 12, 4)
  ctx.fill(); ctx.stroke()
  const lift = Math.sin(tick * 0.12 + x * 0.01) * 3
  ctx.strokeStyle = `rgba(165, 243, 252, ${0.6 + 0.4 * pulse})`
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  for (let i = 0; i < 2; i++) {
    const dy = i * 8
    ctx.beginPath()
    ctx.moveTo(-12, -20 - dy + lift)
    ctx.lineTo(0, -30 - dy + lift)
    ctx.lineTo(12, -20 - dy + lift)
    ctx.stroke()
  }
  ctx.font = 'bold 10px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(165, 243, 252, 0.9)'
  ctx.fillText('弹射', 0, 12)
  ctx.restore()
}
