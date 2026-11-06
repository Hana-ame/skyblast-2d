// web/app/events.ts —— 权威世界事件 → 表现层（killfeed/特效/震颤/光束/死亡信息）
import type { WorldEvent } from '../../core/types.ts'
import {
  screenFx, localPlayer, effects, beams,
} from './context.ts'
import { TEAM_PALETTE } from '../sprites.ts'
import { addKillFeed, showToast } from './toast.ts'

/** 本机最近一次死亡信息（死亡界面显示击杀者） */
export const death = { info: null as { killer: string; weapon: string } | null }

export function handleEvents(evs: WorldEvent[]): void {
  for (const e of evs) {
    if (e.kind === 'kill') {
      addKillFeed(e.killerName ?? '?', e.killerTeam ?? 'ffa', e.victimName ?? '?', e.victimTeam ?? 'ffa', e.weaponLabel ?? '', e.isHeadshot, e.isPierced)
      if (e.victimId === localPlayer.id) death.info = { killer: e.killerName ?? '战场环境', weapon: e.weaponLabel ?? '' }
      if (e.x !== undefined && e.y !== undefined) effects.killBurst(e.x, e.y, TEAM_PALETTE[e.victimTeam ?? 'red']?.light ?? '#fda4af')
    } else if (e.kind === 'explosion') {
      screenFx.shake = Math.max(screenFx.shake, Math.min(14, (e.radius ?? 60) * 0.15))
      if (e.x !== undefined && e.y !== undefined) effects.explosion(e.x, e.y, e.radius ?? 60)
    } else if (e.kind === 'obstacle_destroy') {
      if (e.x !== undefined && e.y !== undefined) effects.debris(e.x, e.y, 50, 60, '#9a3412', '#f97316')
    } else if (e.kind === 'capture') showToast(`🚩 据点 ${e.pointCode} 被 ${e.team} 占领！`)
    else if (e.kind === 'supply_pickup') {
      showToast(`📦 拾取【${e.weaponName}】`)
      if (e.x !== undefined && e.y !== undefined) effects.sparkle(e.x, e.y, '#a5f3fc')
    } else if (e.kind === 'ammo_pickup') {
      if (e.x !== undefined && e.y !== undefined) effects.sparkle(e.x, e.y, '#4ade80')
    } else if (e.kind === 'doll_recall') {
      showToast('🎎 替身人偶生效：回到锚点位置与状态！')
      if (e.x !== undefined && e.y !== undefined) effects.sparkle(e.x, e.y, '#f472b6')
    } else if (e.kind === 'shield_break') showToast('💥 护盾破碎！')
    else if (e.kind === 'mortar_fire') {
      screenFx.shake = Math.max(screenFx.shake, 9)
      if (e.x !== undefined && e.y !== undefined) effects.muzzle(e.x, e.y - 20, '#fde047')
    } else if (e.kind === 'airstrike_drop') {
      if (e.x !== undefined && e.y !== undefined) {
        effects.explosion(e.x, e.y, 120)
        screenFx.shake = Math.max(screenFx.shake, 12)
      }
    } else if (e.kind === 'laser') {
      if (e.segments && e.segments.length > 0) {
        const dur = e.duration ?? 0.14
        beams.push({ segments: e.segments, color: e.color ?? '#22d3ee', life: dur, maxLife: dur })
        if (beams.length > 24) beams.shift()
      }
      screenFx.shake = Math.max(screenFx.shake, 1.5)
    } else if (e.kind === 'warp') showToast(`🌀 ${e.weaponName ?? '传送'}！`)
  }
}

