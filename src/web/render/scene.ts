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
import {
  drawPlayerSprite, drawPlayerTag, drawObstacleSprite, drawCrateSprite, drawAmmoSprite,
  drawMortarSprite, drawTowerSprite, drawWarpSprite, drawFlagSprite, getFlagPalette, drawMineSprite,
  drawGrenadeSprite, drawAirstrikeSprite, drawProjectileSprite, drawDeco, drawJumpPad,
} from '../sprites.ts'

const WRAP_OFFSETS_X = [-WORLD_W, 0, WORLD_W] as const
const WRAP_OFFSETS_Y = [-WORLD_H, 0, WORLD_H] as const
const sharedPt = { x: 0, y: 0 }
let cachedSkyGrad: CanvasGradient | null = null
let cachedSkyGradH = 0
let cachedSkyDepthQuant = -1

export function renderScene(): void {
  if (!ctx || !canvas) return
  // 画布尺寸只由 resizeCanvas()（window resize / ResizeObserver 事件驱动）维护。
  // 绝不能每帧比较 window.innerWidth/innerHeight 并重设 canvas.width/height：
  // 移动端地址栏收放、桌面动态工具栏、页面缩放都会让 innerHeight 抖动 1-2px，
  // 每抖动一次就重建 canvas 后备缓冲 + GPU 纹理（成本随画布面积线性增长，真机十几~几十 ms），
  // 在游戏里表现为"隔一段时间明显卡一下"。这段每帧检查正是该周期性卡顿的来源。
  const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0]
  const mounted = world.mortars.find(m => m.operatorId === localPlayer.id)
  const targetFov = localPlayer.mountedTowerId
    ? 2.0   // 瞭望塔：视野 200%，下塔即失效
    : (mounted ? 1.0 : (wep.fovMult || 1.0))
  camera.fovFactor += (targetFov - camera.fovFactor) * 0.12

  // 相机跟随（双轴环形最短位移）：**始终以玩家为屏幕中心**，不随瞄准方向偏移
  if (localPlayer.deployed) {
    const tx = localPlayer.pos.x
    const ty = localPlayer.pos.y - 12
    camera.x = wrapX(camera.x + wrapDeltaX(camera.x, tx) * 0.2)
    camera.y = wrapY(camera.y + wrapDeltaY(camera.y, ty) * 0.2)
  }

  let shakeX = 0, shakeY = 0
  if (screenFx.shake > 0.2) {
    shakeX = (Math.random() - 0.5) * screenFx.shake * 2
    shakeY = (Math.random() - 0.5) * screenFx.shake * 2
    screenFx.shake *= 0.86
  } else screenFx.shake = 0

  const zoom = 1 / camera.fovFactor
  const halfW = (canvas.width * camera.fovFactor) / 2 + 160
  const halfH = (canvas.height * camera.fovFactor) / 2 + 160

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

  const sx = (wx: number): number => wrapDeltaX(camera.x, wx)
  const sy = (wy: number): number => wrapDeltaY(camera.y, wy)
  const inView = (dx: number, dy: number, pad = 0): boolean =>
    dx > -halfW - pad && dx < halfW + pad && dy > -halfH - pad && dy < halfH + pad
  const inViewRect = (dx: number, dy: number, padX: number, padY: number): boolean =>
    dx > -halfW - padX && dx < halfW + padX && dy > -halfH - padY && dy < halfH + padY

  // 世界锚定星空（随地形移动，无相对滑动）
  for (const st of worldStars) {
    const px = sx(st.x)
    const py = sy(st.y)
    if (!inView(px, py)) continue
    ctx.globalAlpha = st.a * (0.6 + 0.4 * Math.sin(world.tick * 0.02 + st.x * 0.05))
    ctx.fillStyle = '#dbeafe'
    ctx.beginPath(); ctx.arc(px, py, st.r, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1
  for (const gl of worldGlows) {
    const gx = sx(gl.x)
    const gy = sy(gl.y)
    if (!inView(gx, gy, gl.r)) continue
    const grad = ctx.createRadialGradient(gx, gy, 10, gx, gy, gl.r)
    grad.addColorStop(0, `rgba(${gl.c}, ${gl.a})`)
    grad.addColorStop(1, `rgba(${gl.c}, 0)`)
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(gx, gy, gl.r, 0, Math.PI * 2); ctx.fill()
  }

  // 1. 地形图元（程序化贴图）
  syncTerrainPatterns(camera.x, camera.y)
  for (const r of world.terrain.rects) {
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
        // 全图所有方块边缘高亮色严格保持一致 (#38bdf8)
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 2
        ctx.strokeRect(left + 1, top + 1, r.w - 2, r.h - 2)
        if (r.label && (r.kind === 'building_roof' || r.kind === 'pipe_wall' || r.kind === 'bridge')) {
          ctx.fillStyle = 'rgba(226, 232, 240, 0.75)'
          ctx.font = 'bold 12px Inter, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText(r.label, cx, top - 8)
        }
      }
    }
  }

  // 1.2 左右基地出生点光环（FFA 出生点已拆到独立数组 FFA_SPAWN_POINTS，此处只画红蓝基地）
  for (const sp of SPAWN_POINTS) {
    if (sp.team === 'green' || sp.team === 'ffa') continue // 只画红蓝基地，隐藏绿/FFA 出生点标记
    const px = sx(sp.x)
    const py = sy(sp.y)
    if (!inView(px, py, 120)) continue
    ctx.save()
    {
      ctx.translate(px, py - 42)
      // 对应设计图左蓝椭圆、右红椭圆基地传送门
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
    }
    ctx.restore()
  }

  // 1.5 弹射跳台
  for (const pad of JUMP_PADS) {
    const px = sx(pad.x)
    const py = sy(pad.y)
    if (!inView(px, py, 60)) continue
    drawJumpPad(ctx, px, py, world.tick)
  }

  // 2. 可破坏障碍物
  for (const ob of world.obstacles) {
    const ox = sx(ob.x + ob.w / 2)
    const oy = sy(ob.y + ob.h / 2)
    if (!inViewRect(ox, oy, ob.w * 0.5, ob.h * 0.5)) continue
    drawObstacleSprite(ctx, ob, ox, oy)
  }

  // 3. 占领点（同时绘制与旗帜颜色严格一致的地面光圈与复活点信标）
  for (const cp of world.capturePoints) {
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
      // 地面光圈填充与描边严格采用旗帜同一套调色板 (pal.glow / pal.color)
      ctx.fillStyle = pal.glow
      ctx.strokeStyle = pal.color
      ctx.lineWidth = isSelected ? 3.5 : 2.5
      ctx.globalAlpha = isSelected ? 1 : (selectable ? 0.82 + 0.18 * pulse : 0.78)
      ctx.beginPath()
      ctx.ellipse(0, 0, 44, 10, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      if (isSelected) {
        // 选中态叠加同色系内环高亮，不改变旗帜对应光圈色相
        ctx.strokeStyle = pal.light
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.ellipse(0, 0, 34, 7, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      if (featureFlags.captureHudRing && cp.progress > 0 && cp.progress < 100) {
        // 地面占点进度外弧（随 cp.progress 0..100% 动态环绕地面光圈）
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
  for (const wp of world.warpPortals) {
    const wx = sx(wp.x)
    const wy = sy(wp.y)
    if (!inView(wx, wy)) continue
    drawWarpSprite(ctx, wp, wx, wy, world.tick)
  }

  // 5. 瞭望塔
  for (const tw of world.watchtowers) {
    const tx = sx(tw.x)
    const ty = sy(tw.y)
    if (!inView(tx, ty, 200)) continue
    drawTowerSprite(ctx, tw, tx, ty, world.tick)
  }

  // 6. 弹药点
  for (const pack of world.ammoPacks) {
    const px = sx(pack.x)
    const py = sy(pack.y)
    if (!inView(px, py)) continue
    drawAmmoSprite(ctx, pack, px, py, world.tick)
  }

  // 7. 补给箱
  for (const crate of world.supplyCrates) {
    if (!crate.active) continue
    const cx = sx(crate.x)
    const cy = sy(crate.y)
    if (!inView(cx, cy)) continue
    drawCrateSprite(ctx, crate, cx, cy, world.tick)
  }

  // 8. 迫击炮
  for (const m of world.mortars) {
    const mx = sx(m.x)
    const my = sy(m.y)
    if (!inView(mx, my)) continue
    drawMortarSprite(ctx, m, mx, my, world.tick)
  }

  // 9. 地雷
  for (const m of world.landmines) {
    if (m.respawnTimer > 0) continue
    const mx = sx(m.pos.x)
    const my = sy(m.pos.y)
    if (!inView(mx, my)) continue
    drawMineSprite(ctx, m, mx, my, world.tick, world.config.mineTriggerRadius)
  }

  // 10. 玩家 sprite + 头顶标签（含替身人偶幻影与换弹微缩环）
  for (const p of world.players) {
    if (p.respawnTimer > 0 || !p.deployed) continue
    const pWep = WEAPONS[p.weaponIndex] ?? WEAPONS[0]
    const pMounted = world.mortars.some(m => m.operatorId === p.id)

    // 替身人偶幻影
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

    const px = sx(p.pos.x)
    const py = sy(p.pos.y)
    if (!inView(px, py)) continue

    drawPlayerSprite(ctx, p, px, py, {
      tick: world.tick,
      isLocal: p.id === localPlayer.id,
      movingX: p.vel.x,
      floating: p.jetpack,
      mounted: pMounted,
    })
    drawPlayerTag(ctx, p, px, py, p.id === localPlayer.id)

    // 玩家头顶精致换弹进度条
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

    // Teleport 读条进度条 + 右键目标落点信标
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

  // 10.5 迫击炮瞄准线 + 鼠标准星（含战术换弹环与蓄力环）
  const mountedNow = world.mortars.find(m => m.operatorId === localPlayer.id)
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
    for (const sz of world.terrain.shadows) {
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
  for (const r of world.terrain.rects) {
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
  for (const g of world.grenades) {
    const gx = sx(g.pos.x)
    const gy = sy(g.pos.y)
    if (!inView(gx, gy)) continue
    drawGrenadeSprite(ctx, g, gx, gy, world.tick)
  }
  for (const pr of world.projectiles) {
    const px = sx(pr.pos.x)
    const py = sy(pr.pos.y)
    if (!inView(px, py, 200)) continue
    drawProjectileSprite(ctx, pr, px, py, world.tick)
  }
  for (const st of world.airstrikes) {
    const ax = sx(st.pos.x)
    const ay = sy(st.pos.y)
    if (!inView(ax, ay, 60)) continue
    drawAirstrikeSprite(ctx, st, ax, ay, world.tick)
  }

  // 12.5 高斯枪光束
  for (const b of beams) {
    const alpha = Math.max(0, b.life / b.maxLife)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.lineCap = 'round'
    const polys = expandBeamSegments(b.segments, (wx, wy) => ({ x: sx(wx), y: sy(wy) }), halfW, halfH)
    ctx.strokeStyle = b.color
    ctx.lineWidth = 9
    ctx.globalAlpha = alpha * 0.35
    for (const pl of polys) {
      ctx.beginPath()
      ctx.moveTo(pl.x1, pl.y1)
      ctx.lineTo(pl.x2, pl.y2)
      ctx.stroke()
    }
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.4
    for (const pl of polys) {
      ctx.beginPath()
      ctx.moveTo(pl.x1, pl.y1)
      ctx.lineTo(pl.x2, pl.y2)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 13. 客户端粒子
  effects.render(ctx, (x, y) => { sharedPt.x = sx(x); sharedPt.y = sy(y); return sharedPt }, inView, sx, sy)

  ctx.restore()
}
