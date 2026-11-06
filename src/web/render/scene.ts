// web/render.ts —— 场景渲染（地形/精灵/光束/粒子/背景），只读上下文状态
import {
  ctx, canvas, camera, screenFx, world, localPlayer, effects, beams, mouse,
  worldStars, worldGlows,
} from '../app/context.ts'
import { WEAPONS } from '../../core/weapons.ts'
import { getPhysicsParams } from '../../core/sim/physics.ts'
import { WORLD_W, WORLD_H, SURFACE_Y, wrapX, wrapY, wrapDeltaX, wrapDeltaY, clamp } from '../../core/wrap.ts'
import { JUMP_PADS } from '../../core/sim/world.ts'
import { getTerrainPattern, syncTerrainPatterns } from '../textures.ts'
import {
  drawPlayerSprite, drawPlayerTag, drawObstacleSprite, drawCrateSprite, drawAmmoSprite,
  drawMortarSprite, drawTowerSprite, drawWarpSprite, drawFlagSprite, drawMineSprite,
  drawGrenadeSprite, drawAirstrikeSprite, drawProjectileSprite, drawDeco, drawJumpPad,
  TEAM_PALETTE,
} from '../sprites.ts'

// ── 渲染：相机居中 + 双轴环形最短位移（跨缝自动走最近象限） ──
const TEAM_COLOR: Record<string, string> = { red: '#f43f5e', blue: '#0ea5e9', green: '#10b981', ffa: '#eab308' }
const TEAM_LIGHT2: Record<string, string> = { red: '#fda4af', blue: '#7dd3fc', green: '#6ee7b7', ffa: '#fde047' }

export function renderScene(): void {
  if (!ctx || !canvas) return
  const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0]
  const mounted = world.mortars.find(m => m.operatorId === localPlayer.id)
  const targetFov = localPlayer.mountedTowerId
    ? 2.0   // 瞭望塔：视野 200%，下塔即失效
    : (mounted ? 1.0 : (wep.fovMult || 1.0))
  camera.fovFactor += (targetFov - camera.fovFactor) * 0.12

  // 相机跟随（双轴环形最短位移）：**始终以玩家为屏幕中心**，不随瞄准方向偏移
  // （旧实现 +cos(aim)*80 / +sin(aim)*55 会让视角中心永久偏离玩家，尤其瞭望塔 200% 视野下更明显）
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
  const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height)
  // 天幕颜色随相机深度变化（地表附近偏夜空蓝，地下渐暗），避免"背景固定"的违和感
  const depthT = clamp((camera.y - (SURFACE_Y - 1400)) / 1800, 0, 1)
  const topR = Math.round(5 + depthT * 4)
  const topB = Math.round(17 - depthT * 10)
  skyGrad.addColorStop(0, `rgb(${topR}, ${Math.round(8 + depthT * 4)}, ${topB + 4})`)
  skyGrad.addColorStop(0.55, `rgb(${Math.round(15 - depthT * 9)}, ${Math.round(23 - depthT * 12)}, ${Math.round(42 - depthT * 22)})`)
  skyGrad.addColorStop(1, `rgb(${Math.round(30 - depthT * 20)}, ${Math.round(27 - depthT * 17)}, ${Math.round(75 - depthT * 45)})`)
  ctx.fillStyle = skyGrad
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 顺序必须是先平移后缩放：屏幕 = 中心 + zoom × 世界相对量。
  // 反了的话（先 scale 后 translate）zoom≠1 时整个世界会缩到偏左上，+30% 武器视角就不居中。
  ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY)
  ctx.scale(zoom, zoom)

  const sx = (wx: number): number => wrapDeltaX(camera.x, wx)
  const sy = (wy: number): number => wrapDeltaY(camera.y, wy)
  const inView = (dx: number, dy: number, pad = 0): boolean =>
    dx > -halfW - pad && dx < halfW + pad && dy > -halfH - pad && dy < halfH + pad

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
  // 世界固定色光晕（地下掩体/中央浮岛的环境光）
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

  // 1. 地形图元（程序化贴图）——按 ±WORLD_W/±WORLD_H 复制绘制，修复左右/上下接缝处缺块
  //    每帧把花纹锚点补偿到相机：贴图随世界/方块/物体一起移动（此前花纹固定在屏幕上）
  syncTerrainPatterns(camera.x, camera.y)
  for (const r of world.terrain.rects) {
    if (r.kind.startsWith('deco_')) continue
    const cx0 = sx(r.x + r.w / 2)
    const cy0 = sy(r.y + r.h / 2)
    for (const ox of [-WORLD_W, 0, WORLD_W]) {
      for (const oy of [-WORLD_H, 0, WORLD_H]) {
        const cx = cx0 + ox
        const cy = cy0 + oy
        if (!inView(cx, cy, Math.max(r.w, r.h))) continue
        const left = cx - r.w / 2
        const top = cy - r.h / 2
        const pat = getTerrainPattern(ctx, r.kind)
        ctx.fillStyle = pat ?? r.color
        ctx.fillRect(left, top, r.w, r.h)
        // 顶面高光 + 底面阴影（体积感）
        if (r.kind !== 'tunnel_bg' && r.kind !== 'pipe_bg' && r.kind !== 'building_bg') {
          ctx.fillStyle = 'rgba(255,255,255,0.10)'
          ctx.fillRect(left, top, r.w, 2)
          ctx.fillStyle = 'rgba(0,0,0,0.22)'
          ctx.fillRect(left, top + r.h - 3, r.w, 3)
        }
        if (r.borderColor) {
          ctx.strokeStyle = r.borderColor
          ctx.lineWidth = r.kind === 'pipe_wall' ? 3 : 2
          ctx.strokeRect(left + 1, top + 1, r.w - 2, r.h - 2)
        }
        if (r.label && (r.kind === 'building_roof' || r.kind === 'pipe_wall' || r.kind === 'bridge')) {
          ctx.fillStyle = 'rgba(226, 232, 240, 0.75)'
          ctx.font = 'bold 12px Inter, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText(r.label, cx, top - 8)
        }
      }
    }
  }

  // 1.5 弹射跳台（可见底座/箭头/光晕；世界锚定）
  for (const pad of JUMP_PADS) {
    const px = sx(pad.x)
    const py = sy(pad.y)
    if (!inView(px, py, 60)) continue
    drawJumpPad(ctx, px, py, world.tick)
  }

  // 2. 可破坏障碍物（受损裂纹 sprite）
  for (const ob of world.obstacles) {
    const ox = sx(ob.x + ob.w / 2)
    const oy = sy(ob.y + ob.h / 2)
    if (!inView(ox, oy, Math.max(ob.w, ob.h))) continue
    drawObstacleSprite(ctx, ob, ox, oy)
  }

  // 3. 占领点（旗帜 sprite，旗面飘动）
  for (const cp of world.capturePoints) {
    const cx = sx(cp.x)
    const cy = sy(cp.y)
    if (!inView(cx, cy, 140)) continue
    drawFlagSprite(ctx, cp, cx, cy, world.tick)
  }

  // 4. 传送门（旋转光环）
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

  // 7. 补给箱（武器/人偶）
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

  // 10. 玩家 sprite + 头顶标签（含替身人偶幻影/激光武器瞄准线）
  for (const p of world.players) {
    if (p.respawnTimer > 0 || !p.deployed) continue
    const w = WEAPONS[p.weaponIndex] ?? WEAPONS[0]
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

    // 激光类武器的长瞄准线
    if (w.laser && !pMounted) {
      ctx.save()
      ctx.translate(px, py)
      ctx.strokeStyle = w.id === 4 ? 'rgba(34, 211, 238, 0.35)' : 'rgba(192, 132, 252, 0.32)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(0, -10)
      ctx.lineTo(Math.cos(p.aim) * 820, -10 + Math.sin(p.aim) * 820)
      ctx.stroke()
      ctx.restore()
    }

    drawPlayerSprite(ctx, p, px, py, {
      tick: world.tick,
      isLocal: p.id === localPlayer.id,
      movingX: p.vel.x,
      floating: p.jetpack,
      mounted: pMounted,
    })
    drawPlayerTag(ctx, p, px, py, p.id === localPlayer.id)
  }

  // 10.5 迫击炮瞄准线 + 鼠标准星
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
    // 落点预示（抛物线近似）
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(mx + Math.cos(mountedNow.angle) * aimLen, my - 18 + Math.sin(mountedNow.angle) * aimLen, 26, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  // 鼠标准星（世界坐标 → 屏幕）
  {
    const mx = sx(mouse.worldX)
    const my = sy(mouse.worldY)
    // mx/my 是世界相对量（用户坐标，乘 zoom 后映射到屏幕）；这里必须用 halfW/halfH 判定可见性。
    // 旧代码与画布像素比较 → 鼠标在屏幕左半区时被误判为不可见（“准星在左侧显示有问题”）。
    if (mx > -halfW && mx < halfW && my > -halfH && my < halfH) {
      ctx.save()
      ctx.strokeStyle = mountedNow ? 'rgba(251, 146, 60, 0.95)' : 'rgba(255, 255, 255, 0.8)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(mx - 9, my); ctx.lineTo(mx - 3, my)
      ctx.moveTo(mx + 3, my); ctx.lineTo(mx + 9, my)
      ctx.moveTo(mx, my - 9); ctx.lineTo(mx, my - 3)
      ctx.moveTo(mx, my + 3); ctx.lineTo(mx, my + 9)
      ctx.stroke()
      ctx.beginPath(); ctx.arc(mx, my, 2, 0, Math.PI * 2); ctx.stroke()
      // 蓄力环：按下后即使松开也会继续蓄满自动击发（避免"点了没反应"）
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
      ctx.restore()
    }
  }

  // 11. 动态阴影（瞭望塔视野激活时不遮）——同样按 ±WORLD 复制，修复接缝处漏光/缺遮
  if (!localPlayer.mountedTowerId) {
    for (const sz of world.terrain.shadows) {
      const cx0 = sx(sz.x + sz.w / 2)
      const cy0 = sy(sz.y + sz.h / 2)
      for (const ox of [-WORLD_W, 0, WORLD_W]) {
        for (const oy of [-WORLD_H, 0, WORLD_H]) {
          const cx = cx0 + ox
          const cy = cy0 + oy
          if (!inView(cx, cy, Math.max(sz.w, sz.h))) continue
          const inside = localPlayer.deployed &&
            Math.abs(wrapDeltaX(localPlayer.pos.x, sz.x + sz.w / 2)) <= sz.w / 2 + 40 &&
            Math.abs(wrapDeltaY(localPlayer.pos.y, sz.y + sz.h / 2)) <= sz.h / 2 + 40
          ctx.fillStyle = inside ? 'rgba(2, 6, 23, 0.22)' : `rgba(2, 6, 23, ${sz.alpha ?? 0.74})`
          ctx.fillRect(cx - sz.w / 2, cy - sz.h / 2, sz.w, sz.h)
        }
      }
    }
  }

  // 11.5 装饰层（窗户灯/路灯/缆线/天线/蒸汽口/警示条/油桶/管道/梯子/标牌）——画在阴影之后，灯光不被压暗
  for (const r of world.terrain.rects) {
    if (!r.kind.startsWith('deco_')) continue
    const cx0 = sx(r.x + r.w / 2)
    const cy0 = sy(r.y + r.h / 2)
    for (const ox of [-WORLD_W, 0, WORLD_W]) {
      for (const oy of [-WORLD_H, 0, WORLD_H]) {
        const cx = cx0 + ox
        const cy = cy0 + oy
        if (!inView(cx, cy, Math.max(r.w, r.h) + 40)) continue
        drawDeco(ctx, r, cx, cy, world.tick)
      }
    }
  }

  // 12. 手雷 / 弹丸 / 空袭信标（sprite）
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

  // 12.5 激光束（分段折线，按秒淡出；反射 3 次由权威端算好）
  for (const b of beams) {
    const alpha = Math.max(0, b.life / b.maxLife)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.lineCap = 'round'
    // 外层辉光
    ctx.strokeStyle = b.color
    ctx.lineWidth = 9
    ctx.globalAlpha = alpha * 0.35
    for (const seg of b.segments) {
      ctx.beginPath()
      ctx.moveTo(sx(seg.x1), sy(seg.y1))
      ctx.lineTo(sx(seg.x2), sy(seg.y2))
      ctx.stroke()
    }
    // 内芯
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.4
    for (const seg of b.segments) {
      ctx.beginPath()
      ctx.moveTo(sx(seg.x1), sy(seg.y1))
      ctx.lineTo(sx(seg.x2), sy(seg.y2))
      ctx.stroke()
    }
    ctx.restore()
  }

  // 13. 客户端粒子（爆炸/击杀/拾取/喷气/枪口）
  effects.render(ctx, (x, y) => ({ x: sx(x), y: sy(y) }), (x, y) => inView(x, y))

  ctx.restore()
}

