// web/app/toast.ts —— Toast 提示 / Killfeed / HTML 转义（纯 DOM 表现层）

// ── Toast / Killfeed ──
export function escapeHtml(str: string): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

let toastTimer = 0
export function showToast(msg: string): void {
  const el = document.getElementById('toastBanner')
  if (!el) return
  el.textContent = msg
  el.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), 3400)
}

const TEAM_LIGHT: Record<string, string> = { red: '#fda4af', blue: '#7dd3fc', green: '#6ee7b7', ffa: '#fde047' }

export function addKillFeed(killerName: string, killerTeam: string, victimName: string, victimTeam: string, weaponLabel: string, isHeadshot?: boolean, isPierced?: boolean): void {
  const feed = document.getElementById('killFeedContainer')
  if (!feed || typeof document.createElement !== 'function') return
  const item = document.createElement('div')
  item.className = 'kill-item glass-panel px-3 py-1.5 rounded-xl border border-slate-700/90 shadow-lg flex items-center gap-2 text-xs'
  item.innerHTML = `
    <span class="font-extrabold" style="color:${TEAM_LIGHT[killerTeam] ?? '#fda4af'}">${escapeHtml(killerName)}</span>
    <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-200 border border-slate-700">${escapeHtml(weaponLabel)}</span>
    ${isHeadshot ? '<span class="px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-400 text-amber-300 text-[10px] font-extrabold">🎯 爆头</span>' : ''}
    ${isPierced ? '<span class="px-1.5 py-0.5 rounded bg-purple-500/25 border border-purple-400 text-purple-200 text-[10px] font-extrabold">⚡ 穿透</span>' : ''}
    <span class="font-extrabold" style="color:${TEAM_LIGHT[victimTeam] ?? '#7dd3fc'}">${escapeHtml(victimName)}</span>
  `
  feed.prepend(item)
  while (feed.children.length > 6) feed.removeChild(feed.lastChild!)
  window.setTimeout(() => item.remove(), 6500)
}

