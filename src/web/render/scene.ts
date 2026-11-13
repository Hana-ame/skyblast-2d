// web/render.ts —— 场景渲染（地形/精灵/光束/粒子/背景），只读上下文状态
import {
  ctx, canvas, camera, screenFx, world, localPlayer, pendingLoadout, effects, beams, mouse,
  worldStars, worldGlows, featureFlags,
} from '../app/context.ts'
import { WEAPONS } from '../../core/weapons.ts'
import { WORLD_W, WORLD_H, SURFACE_Y, wrapX, wrapY, wrapDeltaX, wrapDeltaY, clamp } from '../../core/wrap.ts'
import { JUMP_PADS, SPAWN_POINTS, isCapturePointSelectable } from '../../core/sim/world.ts'
import { expandBeamSegments } from './beamGeometry.ts'
import { getTerrainPattern, syncTerrainPatterns } from '../textures.ts'
import { getRenderPos } from '../game/interp.ts'
import {
  drawPlayerSprite, drawPlayerTag, drawObstacleSprite, drawCrateSprite, drawAmmoSprite,
  drawMortarSprite, drawTowerSprite, drawWarpSprite, drawFlagSprite, getFlagPalette, drawMineSprite,
  drawGrenadeSprite, drawAirstrikeSprite, drawProjectileSprite, drawDeco, drawJumpPad,
} from '../sprites.ts'

const WRAP_OFFSETS_X = [-WORLD_W, 0, WORLD_W] as const
const WRAP_OFFSETS_Y = [-WORLD_H, 0, WORLD_H] as const
const sharedPt = { x: 0, y: 0 }
const sharedBeamPt = { x: 0, y: 0 }
let cachedSkyGrad: CanvasGradient | null = null
let cachedSkyGradH = 0
let cachedSkyDepthQuant = -1
const cachedWorldGlowGrads = new Map<string, CanvasGradient>()

// 星空绘制优化：原实现每颗星一次 beginPath+arc+fill 且每颗都改 globalAlpha，
// 在真机 GPU 上频繁的状态切换会打断绘制批处理。改法：
//  - alpha 量化成 4 档，同档的星合并到一条 path 里一次 fill（最多 4 次 fill）；
//  - 星点用 fillRect 小方块代替 arc，避免每个圆形的三角化开销（1-2px 星星肉眼无差别）。
const STAR_ALPHA_LEVELS = 4

function drawStars(
  ctx2: CanvasRenderingContext2D,
  sxFn: (wx: number) => number,
  syFn: (wy: number) => number,
  inViewFn: (dx: number, dy: number, pad?: number) => boolean,
): void {
  const tick = world.tick
  ctx2.fillStyle = '#dbeafe'
  for (let level = 0; level < STAR_ALPHA_LEVELS; level++) {
    let began = false
    for (let i = 0; i < worldStars.length; i++) {
      const st = worldStars[i]
      const px = sxFn(st.x)
      const py = syFn(st.y)
      if (!inViewFn(px, py)) continue
      const tw = 0.6 + 0.4 * Math.sin(tick * 0.02 + st.x * 0.05)
      const lv = Math.min(STAR_ALPHA_LEVELS - 1, Math.floor(st.a * tw * STAR_ALPHA_LEVELS))
      if (lv !== level) continue
      const d = st.r * 2
      // 合并进同一条 path（fillRect 会各自提交，故用 rect 累进 path 再一次性 fill）
      if (!began) { ctx2.beginPath(); began = true }
      ctx2.rect(px - st.r, py - st.r, d, d)
    }
    if (began) {
      ctx2.globalAlpha = (level + 0.5) / STAR_ALPHA_LEVELS
      ctx2.fill()
    }
  }
  ctx2.globalAlpha = 1
}

let curHalfW = 960
let curHalfH = 540

function sx(wx: number): number {
  return wrapDeltaX(camera.x, wx)
}
function sy(wy: number): number {
  return wrapDeltaY(camera.y, wy)
}
function inView(dx: number, dy: number, pad = 0): boolean {
  return dx > -curHalfW - pad && dx < curHalfW + pad && dy > -curHalfH - pad && dy < curHalfH + pad
}
function inViewRect(dx: number, dy: number, padX: number, padY: number): boolean {
  return dx > -curHalfW - padX && dx < curHalfW + padX && dy > -curHalfH - padY && dy < curHalfH + padY
}
function beamScreenProject(wx: number, wy: number): { x: number; y: number } {
  sharedBeamPt.x = wrapDeltaX(camera.x, wx)
  sharedBeamPt.y = wrapDeltaY(camera.y, wy)
  return sharedBeamPt
}
function effectsScreenProject(wx: number, wy: number): { x: number; y: number } {
  sharedPt.x = wrapDeltaX(camera.x, wx)
  sharedPt.y = wrapDeltaY(camera.y, wy)
  return sharedPt
}

export function renderScene(): void {
  if (!ctx || !canvas) return
  // 画布尺寸只由 resizeCanvas()（window resize / ResizeObserver 事件驱动）维护。
  // 绝不能每帧比较 window.innerWidth/innerHeight 并重设 canvas.width/height：
  // 移动端地址栏收放、桌面动态工具栏、页面缩放都会让 innerHeight 抖动 1-2px，
  // 每抖动一次就重建 canvas 后备缓冲 + GPU 纹理（成本随画布面积线性增长，真机十几~几十 ms），
  // 在游戏里表现为"隔一段时间明显卡一下"。这段每帧检查正是该周期性卡顿的来源。

  let shakeX = 0, shakeY = 0
  if (screenFx.shake > 0.2) {
    shakeX = (Math.random() - 0.5) * screenFx.shake * 2
    shakeY = (Math.random() - 0.5) * screenFx.shake * 2
    screenFx.shake *= 0.86
  } else screenFx.shake = 0

  const zoom = 1 / camera.fovFactor
  const halfW = (canvas.width * camera.fovFactor) / 2 + 160
  const halfH = (canvas.height * camera.fovFactor) / 2 + 160
  curHalfW = halfW
  curHalfH = halfH

  // ── 背景：与地形同坐标系的世界锚定层（不产生相对滑动） ──
  ctx.save()
  const depthT = clamp((camera.y - (SURFACE_Y - 1400)) / 1800, 0, 1)
  const depthQuant = Math.round(depthT * 25)
  if (!cachedSkyGrad || cachedSkyGradH !== canvas.height || cachedSkyDepthQuant !== depthQuant) {
    cachedSkyGradH = canvas.height
    cachedSkyDepthQuant = depthQuant
    const qT = depthQuant / 25
    const topR = Math.round(5 + qT * 4)
    const topB = Math.round(17 - qT * 10)
    cachedSkyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height)
    cachedSkyGrad.addColorStop(0, `rgb(${topR}, ${Math.round(8 + qT * 4)}, ${topB + 4})`)
    cachedSkyGrad.addColorStop(0.55, `rgb(${Math.round(15 - qT * 9)}, ${Math.round(23 - qT * 12)}, ${Math.round(42 - qT * 22)})`)
    cachedSkyGrad.addColorStop(1, `rgb(${Math.round(30 - qT * 20)}, ${Math.round(27 - qT * 17)}, ${Math.round(75 - qT * 45)})`)
  }
  ctx.fillStyle = cachedSkyGrad
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY)
  ctx.scale(zoom, zoom)

  // 世界锚定星空（随地形移动，无相对滑动）
  // 性能：原实现对每颗星单独 beginPath+arc+fill 并且每颗星都改一次 globalAlpha，
  // 这会打断 canvas 的绘制批处理（真机 GPU 上状态切换很贵）。改为：
  //  1) 星点用预渲染的离屏贴图（createRadialGradient 一次画好软边圆点）drawImage 贴出；
  //  2) 把连续 alpha 量化成 4 档，同一档内的星合并到一条 path 一次性 fill，
  //     把 per-star 的 alpha 切换与 path 提交压到最多 4 组。
  drawStars(ctx, sx, sy, inView)
  ctx.globalAlpha = 1
  for (let i = 0; i < worldGlows.length; i++) {
    const gl = worldGlows[i]
    const gx = sx(gl.x)
    const gy = sy(gl.y)
    if (!inView(gx, gy, gl.r)) continue
    const gKey = `${gl.c}:${gl.a}:${gl.r}`
    let grad = cachedWorldGlowGrads.get(gKey)
    if (!grad) {
      grad = ctx.createRadialGradient(0, 0, 10, 0, 0, gl.r)
      grad.addColorStop(0, `rgba(${gl.c}, ${gl.a})`)
      grad.addColorStop(1, `rgba(${gl.c}, 0)`)
      cachedWorldGlowGrads.set(gKey, grad)
    }
    ctx.save()
    ctx.translate(gx, gy)
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(0, 0, gl.r, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  // 1. 地形图元（程序化贴图）
  syncTerrainPatterns(camera.x, camera.y)
  // 性能：描边样式对所有地形块完全一致，提到循环外只设一次；
  // 并把所有块的描边合并进同一条 path 一次性 stroke。
  // 原来每块都 strokeRect 且重复设置 strokeStyle/lineWidth，在真机 GPU 上全是多余的状态切换。
  ctx.strokeStyle = '#38bdf8'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let ri = 0; ri < world.terrain.rects.length; ri++) {
    const r = world.terrain.rects[ri]
    if (r.kind.startsWith('deco_')) continue
    const cx0 = sx(r.x + r.w / 2)
    const cy0 = sy(r.y + r.h / 2)
    const rHalfW = r.w * 0.5
    const rHalfH = r.h * 0.5
    for (let ix = 0; ix < 3; ix++) {
      const cx = cx0 + WRAP_OFFSETS_X[ix]
      if (cx <= -halfW - rHalfW || cx >= halfW + rHalfW) continue
      for (let iy = 0; iy < 3; iy++) {
        const cy = cy0 + WRAP_OFFSETS_Y[iy]
        if (cy <= -halfH - rHalfH || cy >= halfH + rHalfH) continue
        const left = cx - r.w / 2
        const top = cy - r.h / 2
        const pat = getTerrainPattern(ctx, r.kind)
        ctx.fillStyle = pat ?? r.color
        ctx.fillRect(left, top, r.w, r.h)
        if (r.kind !== 'tunnel_bg' && r.kind !== 'pipe_bg' && r.kind !== 'building_bg') {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.28)'
          ctx.fillRect(left, top, r.w, 2.5)
          ctx.fillStyle = 'rgba(2, 6, 23, 0.45)'
          ctx.fillRect(left, top + r.h - 3, r.w, 3)
        }
        // 只累进 path，循环结束后统一 stroke
        ctx.rect(left + 1, top + 1, r.w - 2, r.h - 2)
        if (r.label && (r.kind === 'building_roof' || r.kind === 'pipe_wall' || r.kind === 'bridge')) {
          ctx.fillStyle = 'rgba(226, 232, 240, 0.75)'
          ctx.font = 'bold 12px Inter, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText(r.label, cx, top - 8)
        }
      }
    }
  }
  ctx.stroke()

  // 1.2 左右基地出生点光环
  for (let i = 0; i < SPAWN_POINTS.length; i++) {
    const sp = SPAWN_POINTS[i]
    if (sp.team === 'green' || sp.team === 'ffa') continue
    const px = sx(sp.x)
    const py = sy(sp.y)
    if (!inView(px, py, 120)) continue
    ctx.save()
    ctx.translate(px, py - 42)
    const isLeft = sp.x < WORLD_W / 2
    const fillCol = isLeft ? 'rgba(14, 165, 233, 0.32)' : 'rgba(244, 63, 94, 0.32)'
    const strokeCol = isLeft ? '#0ea5e9' : '#f43f5e'
    ctx.fillStyle = fillCol
    ctx.strokeStyle = strokeCol
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.ellipse(0, 0, 38, 56, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.font = 'bold 11px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = isLeft ? '#7dd3fc' : '#fda4af'
    ctx.fillText(isLeft ? '🔵 左翼基地出生点' : '🔴 右翼基地出生点', 0, -66)
    ctx.restore()
  }

  // 1.5 弹射跳台
  for (let i = 0; i < JUMP_PADS.length; i++) {
    const pad = JUMP_PADS[i]
    const px = sx(pad.x)
    const py = sy(pad.y)
    if (!inView(px, py, 60)) continue
    drawJumpPad(ctx, px, py, world.tick)
  }

  // 2. 可破坏障碍物
  for (let i = 0; i < world.obstacles.length; i++) {
    const ob = world.obstacles[i]
    const ox = sx(ob.x + ob.w / 2)
    const oy = sy(ob.y + ob.h / 2)
    if (!inViewRect(ox, oy, ob.w * 0.5, ob.h * 0.5)) continue
    drawObstacleSprite(ctx, ob, ox, oy)
  }

  // 3. 占领点
  for (let i = 0; i < world.capturePoints.length; i++) {
    const cp = world.capturePoints[i]
    const cx = sx(cp.x)
    const cy = sy(cp.y)
    if (!inView(cx, cy, 160)) continue
    if (cp.y > 400) {
      const selectable = isCapturePointSelectable(cp, localPlayer.team)
      const isSelected = selectable && (localPlayer.selectedSpawnId === cp.id || pendingLoadout.spawnPointId === cp.id)
      const pal = getFlagPalette(cp)
      ctx.save()
      ctx.translate(cx, cy + 16)
      const pulse = 0.65 + 0.35 * Math.sin(world.tick * 0.1)
      ctx.fillStyle = pal.glow
      ctx.strokeStyle = pal.color
      ctx.lineWidth = isSelected ? 3.5 : 2.5
      ctx.globalAlpha = isSelected ? 1 : (selectable ? 0.82 + 0.18 * pulse : 0.78)
      ctx.beginPath()
      ctx.ellipse(0, 0, 44, 10, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      if (isSelected) {
        ctx.strokeStyle = pal.light
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.ellipse(0, 0, 34, 7, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      if (featureFlags.captureHudRing && cp.progress > 0 && cp.progress < 100) {
        const pctRad = (Math.min(100, Math.max(0, cp.progress)) / 100) * Math.PI * 2
        ctx.strokeStyle = pal.light
        ctx.lineWidth = 3.2
        ctx.beginPath()
        ctx.ellipse(0, 0, 50, 12.5, 0, -Math.PI / 2, -Math.PI / 2 + pctRad)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      const labelTxt = isSelected
        ? `✅ 已选中【${cp.name}】`
        : selectable
          ? `⚡ ${cp.name} [按 E 选中]`
          : `🔒 ${cp.name}（占领后可选）`
      ctx.font = 'bold 11px Inter, sans-serif'
      ctx.textAlign = 'center'
      const tw = ctx.measureText(labelTxt).width + 14
      ctx.fillStyle = 'rgba(2, 6, 23, 0.82)'
      ctx.strokeStyle = pal.color
      ctx.lineWidth = isSelected ? 1.8 : 1.2
      ctx.beginPath()
      ctx.roundRect(-tw / 2, 12, tw, 18, 6)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = (cp.ownerTeam ?? cp.capturingTeam) ? pal.light : '#cbd5e1'
      ctx.fillText(labelTxt, 0, 25)
      ctx.restore()
    }
    drawFlagSprite(ctx, cp, cx, cy, world.tick)
  }

  // 4. 传送门
  for (let i = 0; i < world.warpPortals.length; i++) {
    const wp = world.warpPortals[i]
    const wx = sx(wp.x)
    const wy = sy(wp.y)
    if (!inView(wx, wy)) continue
    drawWarpSprite(ctx, wp, wx, wy, world.tick)
  }

  // 5. 瞭望塔
  for (let i = 0; i < world.watchtowers.length; i++) {
    const tw = world.watchtowers[i]
    const tx = sx(tw.x)
    const ty = sy(tw.y)
    if (!inView(tx, ty, 200)) continue
    drawTowerSprite(ctx, tw, tx, ty, world.tick)
  }

  // 6. 弹药点
  for (let i = 0; i < world.ammoPacks.length; i++) {
    const pack = world.ammoPacks[i]
    const px = sx(pack.x)
    const py = sy(pack.y)
    if (!inView(px, py)) continue
    drawAmmoSprite(ctx, pack, px, py, world.tick)
  }

  // 7. 补给箱
  for (let i = 0; i < world.supplyCrates.length; i++) {
    const crate = world.supplyCrates[i]
    if (!crate.active) continue
    const cx = sx(crate.x)
    const cy = sy(crate.y)
    if (!inView(cx, cy)) continue
    drawCrateSprite(ctx, crate, cx, cy, world.tick)
  }

  // 8. 迫击炮
  let mountedNow: typeof world.mortars[0] | undefined
  for (let i = 0; i < world.mortars.length; i++) {
    const m = world.mortars[i]
    if (m.operatorId === localPlayer.id) mountedNow = m
    const mx = sx(m.x)
    const my = sy(m.y)
    if (!inView(mx, my)) continue
    drawMortarSprite(ctx, m, mx, my, world.tick)
  }

  // 9. 地雷
  for (let i = 0; i < world.landmines.length; i++) {
    const m = world.landmines[i]
    if (m.respawnTimer > 0) continue
    const mx = sx(m.pos.x)
    const my = sy(m.pos.y)
    if (!inView(mx, my)) continue
    drawMineSprite(ctx, m, mx, my, world.tick, world.config.mineTriggerRadius)
  }

  // 10. 玩家 sprite + 头顶标签
  for (let pi = 0; pi < world.players.length; pi++) {
    const p = world.players[pi]
    if (p.respawnTimer > 0 || !p.deployed) continue
    const pWep = WEAPONS[p.weaponIndex] ?? WEAPONS[0]
    let pMounted = false
    for (let mi = 0; mi < world.mortars.length; mi++) {
      if (world.mortars[mi].operatorId === p.id) { pMounted = true; break }
    }

    if (p.doll) {
      const dx = sx(p.doll.pos.x)
      const dy = sy(p.doll.pos.y)
      if (inView(dx, dy)) {
        ctx.save()
        ctx.translate(dx, dy)
        ctx.globalAlpha = 0.62
        ctx.strokeStyle = '#f472b6'
        ctx.fillStyle = 'rgba(244, 114, 182, 0.22)'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.roundRect(-11, -12, 22, 28, 6); ctx.fill(); ctx.stroke()
        ctx.beginPath(); ctx.arc(0, -24, world.config.headRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        ctx.globalAlpha = 1
        ctx.fillStyle = '#f472b6'
        ctx.font = 'bold 11px Inter, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`🎎 ${p.doll.timer.toFixed(1)}s`, 0, -44)
        ctx.restore()
      }
    }

    // 高刷屏渲染插值：用上一 tick 与当前 tick 之间的中间位置，
    // 避免 58% 的帧里角色完全静止、其余帧一次跳 4px 的顿挫感。
    const rp = getRenderPos(p.id, p.pos.x, p.pos.y)
    const px = sx(rp.x)
    const py = sy(rp.y)
    if (!inView(px, py)) continue

    drawPlayerSprite(ctx, p, px, py, {
      tick: world.tick,
      isLocal: p.id === localPlayer.id,
      movingX: p.vel.x,
      floating: p.jetpack,
      mounted: pMounted,
    })
    drawPlayerTag(ctx, p, px, py, p.id === localPlayer.id)

    if (p.reloading) {
      ctx.save()
      const barW = 42
      const barH = 4
      const bx = px - barW / 2
      const by = py - 60
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
      ctx.beginPath(); ctx.roundRect(bx - 1, by - 1, barW + 2, barH + 2, 2.5); ctx.fill()
      if (pWep.shellReload) {
        const curShells = Math.max(0, Math.floor(p.ammo[p.weaponIndex] ?? 0))
        const perShell = pWep.reloadTime / Math.max(1, pWep.magSize)
        const curShellPct = p.fireCooldown > 0 ? 0 : clamp(1 - p.reloadTimer / Math.max(1e-6, perShell), 0, 1)
        const segW = (barW - (pWep.magSize - 1) * 1.2) / pWep.magSize
        for (let sIdx = 0; sIdx < pWep.magSize; sIdx++) {
          const segX = bx + sIdx * (segW + 1.2)
          ctx.fillStyle = sIdx < curShells ? '#fbbf24' : 'rgba(51, 65, 85, 0.85)'
          ctx.fillRect(segX, by, segW, barH)
          if (sIdx === curShells && curShellPct > 0) {
            ctx.fillStyle = '#38bdf8'
            ctx.fillRect(segX, by, segW * curShellPct, barH)
          }
        }
      } else {
        const pct = clamp(1 - p.reloadTimer / Math.max(1e-6, pWep.reloadTime), 0, 1)
        ctx.fillStyle = '#38bdf8'
        ctx.beginPath(); ctx.roundRect(bx, by, Math.max(2, barW * pct), barH, 2); ctx.fill()
      }
      ctx.restore()
    }

    if ((p.teleportTimer ?? 0) > 0 && p.teleportTarget) {
      const castTotal = Math.max(0.1, world.config.teleportCastTime ?? 0.75)
      const pct = clamp(1 - (p.teleportTimer! / castTotal), 0, 1)
      const tx = sx(p.teleportTarget.x)
      const ty = sy(p.teleportTarget.y)
      ctx.save()
      ctx.setLineDash([6, 6])
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.55)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px, py - 14)
      ctx.lineTo(tx, ty - 14)
      ctx.stroke()
      ctx.setLineDash([])
      if (inView(tx, ty, 80)) {
        const pulse = 18 + Math.sin(world.tick * 0.35) * 4
        ctx.strokeStyle = '#c084fc'
        ctx.fillStyle = 'rgba(192, 132, 252, 0.18)'
        ctx.lineWidth = 2.2
        ctx.beginPath(); ctx.arc(tx, ty - 12, pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        ctx.strokeStyle = '#38bdf8'
        ctx.beginPath(); ctx.arc(tx, ty - 12, pulse * (1 - pct * 0.65), 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = '#e9d5ff'
        ctx.font = 'bold 11px Inter, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('🌀 传送落点', tx, ty - 36)
      }
      const barW = 58
      const barH = 6
      const bx = px - barW / 2
      const by = py - 72
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
      ctx.strokeStyle = '#c084fc'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.roundRect(bx, by, barW, barH, 3); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#a855f7'
      ctx.beginPath(); ctx.roundRect(bx + 1, by + 1, Math.max(2, (barW - 2) * pct), barH - 2, 2); ctx.fill()
      ctx.fillStyle = '#f3e8ff'
      ctx.font = 'bold 10px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`🌀 读条 ${Math.round(pct * 100)}%`, px, by - 4)
      ctx.restore()
    }
  }

  // 10.5 迫击炮瞄准线 + 鼠标准星
  if (mountedNow) {
    const mx = sx(mountedNow.x)
    const my = sy(mountedNow.y)
    const aimLen = 420
    ctx.save()
    ctx.setLineDash([10, 8])
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.75)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(mx + Math.cos(mountedNow.angle) * 30, my - 18 + Math.sin(mountedNow.angle) * 30)
    ctx.lineTo(mx + Math.cos(mountedNow.angle) * aimLen, my - 18 + Math.sin(mountedNow.angle) * aimLen)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(mx + Math.cos(mountedNow.angle) * aimLen, my - 18 + Math.sin(mountedNow.angle) * aimLen, 26, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  {
    const mx = sx(mouse.worldX)
    const my = sy(mouse.worldY)
    if (mx > -halfW && mx < halfW && my > -halfH && my < halfH) {
      ctx.save()
      ctx.strokeStyle = mountedNow ? 'rgba(251, 146, 60, 0.95)' : 'rgba(255, 255, 255, 0.82)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(mx - 9, my); ctx.lineTo(mx - 3, my)
      ctx.moveTo(mx + 3, my); ctx.lineTo(mx + 9, my)
      ctx.moveTo(mx, my - 9); ctx.lineTo(mx, my - 3)
      ctx.moveTo(mx, my + 3); ctx.lineTo(mx, my + 9)
      ctx.stroke()
      ctx.beginPath(); ctx.arc(mx, my, 2, 0, Math.PI * 2); ctx.stroke()
      const wepNow = WEAPONS[localPlayer.weaponIndex]
      const chargeNeed = wepNow?.chargeSeconds ?? 0
      if (chargeNeed > 0 && localPlayer.chargeTimer > 0) {
        const t = Math.min(1, localPlayer.chargeTimer / chargeNeed)
        ctx.strokeStyle = `rgba(253, 224, 71, ${0.5 + 0.5 * t})`
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(mx, my, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t)
        ctx.stroke()
        if (t >= 1) { ctx.fillStyle = 'rgba(253,224,71,0.9)'; ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill() }
      }
      if (localPlayer.reloading && wepNow) {
        const ringR = 15
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)'
        ctx.lineWidth = 3.2
        ctx.beginPath()
        ctx.arc(mx, my, ringR, 0, Math.PI * 2)
        ctx.stroke()
        if (wepNow.shellReload) {
          const perShell = wepNow.reloadTime / Math.max(1, wepNow.magSize)
          const shellPct = localPlayer.fireCooldown > 0 ? 0 : clamp(1 - localPlayer.reloadTimer / Math.max(1e-6, perShell), 0, 1)
          const curAmmo = Math.max(0, Math.floor(localPlayer.ammo[localPlayer.weaponIndex] ?? 0))
          const totalPct = clamp((curAmmo + shellPct) / Math.max(1, wepNow.magSize), 0, 1)
          ctx.strokeStyle = '#fbbf24'
          ctx.lineWidth = 2.6
          ctx.beginPath()
          ctx.arc(mx, my, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * totalPct)
          ctx.stroke()
        } else {
          const pct = clamp(1 - localPlayer.reloadTimer / Math.max(1e-6, wepNow.reloadTime), 0, 1)
          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth = 2.6
          ctx.beginPath()
          ctx.arc(mx, my, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct)
          ctx.stroke()
        }
      }
      ctx.restore()
    }
  }

  // 11. 动态阴影
  if (!localPlayer.mountedTowerId) {
    for (let si = 0; si < world.terrain.shadows.length; si++) {
      const sz = world.terrain.shadows[si]
      const cx0 = sx(sz.x + sz.w / 2)
      const cy0 = sy(sz.y + sz.h / 2)
      const szHalfW = sz.w * 0.5
      const szHalfH = sz.h * 0.5
      for (let ix = 0; ix < 3; ix++) {
        const cx = cx0 + WRAP_OFFSETS_X[ix]
        if (cx <= -halfW - szHalfW || cx >= halfW + szHalfW) continue
        for (let iy = 0; iy < 3; iy++) {
          const cy = cy0 + WRAP_OFFSETS_Y[iy]
          if (cy <= -halfH - szHalfH || cy >= halfH + szHalfH) continue
          const inside = localPlayer.deployed &&
            Math.abs(wrapDeltaX(localPlayer.pos.x, sz.x + sz.w / 2)) <= sz.w / 2 + 40 &&
            Math.abs(wrapDeltaY(localPlayer.pos.y, sz.y + sz.h / 2)) <= sz.h / 2 + 40
          ctx.fillStyle = inside ? 'rgba(2, 6, 23, 0.22)' : `rgba(2, 6, 23, ${sz.alpha ?? 0.74})`
          ctx.fillRect(cx - sz.w / 2, cy - sz.h / 2, sz.w, sz.h)
        }
      }
    }
  }

  // 11.5 装饰层
  for (let ri = 0; ri < world.terrain.rects.length; ri++) {
    const r = world.terrain.rects[ri]
    if (!r.kind.startsWith('deco_')) continue
    const cx0 = sx(r.x + r.w / 2)
    const cy0 = sy(r.y + r.h / 2)
    const decoPadX = r.w * 0.5 + 40
    const decoPadY = r.h * 0.5 + 40
    for (let ix = 0; ix < 3; ix++) {
      const cx = cx0 + WRAP_OFFSETS_X[ix]
      if (cx <= -halfW - decoPadX || cx >= halfW + decoPadX) continue
      for (let iy = 0; iy < 3; iy++) {
        const cy = cy0 + WRAP_OFFSETS_Y[iy]
        if (cy <= -halfH - decoPadY || cy >= halfH + decoPadY) continue
        drawDeco(ctx, r, cx, cy, world.tick)
      }
    }
  }

  // 12. 手雷 / 弹丸 / 空袭信标
  for (let i = 0; i < world.grenades.length; i++) {
    const g = world.grenades[i]
    const gx = sx(g.pos.x)
    const gy = sy(g.pos.y)
    if (!inView(gx, gy)) continue
    drawGrenadeSprite(ctx, g, gx, gy, world.tick)
  }
  for (let i = 0; i < world.projectiles.length; i++) {
    const pr = world.projectiles[i]
    const px = sx(pr.pos.x)
    const py = sy(pr.pos.y)
    if (!inView(px, py, 200)) continue
    drawProjectileSprite(ctx, pr, px, py, world.tick)
  }
  for (let i = 0; i < world.airstrikes.length; i++) {
    const st = world.airstrikes[i]
    const ax = sx(st.pos.x)
    const ay = sy(st.pos.y)
    if (!inView(ax, ay, 60)) continue
    drawAirstrikeSprite(ctx, st, ax, ay, world.tick)
  }

  // 12.5 高斯枪光束
  for (let bi = 0; bi < beams.length; bi++) {
    const b = beams[bi]
    const alpha = Math.max(0, b.life / b.maxLife)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.lineCap = 'round'
    const polys = expandBeamSegments(b.segments, beamScreenProject, halfW, halfH)
    ctx.strokeStyle = b.color
    ctx.lineWidth = 9
    ctx.globalAlpha = alpha * 0.35
    for (let pi = 0; pi < polys.length; pi++) {
      const pl = polys[pi]
      ctx.beginPath()
      ctx.moveTo(pl.x1, pl.y1)
      ctx.lineTo(pl.x2, pl.y2)
      ctx.stroke()
    }
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.4
    for (let pi = 0; pi < polys.length; pi++) {
      const pl = polys[pi]
      ctx.beginPath()
      ctx.moveTo(pl.x1, pl.y1)
      ctx.lineTo(pl.x2, pl.y2)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 13. 客户端粒子
  effects.render(ctx, effectsScreenProject, inView, sx, sy)

  ctx.restore()
}
