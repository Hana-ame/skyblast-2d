// web/input/device.ts —— 输入设备检测 / 触屏层显隐 / 设备徽章
import { touchState } from '../app/context.ts'

export function updateInputModeBadge(isTouchMode: boolean, isAuto: boolean): void {
  const badge = document.getElementById('inputDeviceDetectBadge')
  if (!badge) return
  const prefix = isAuto ? '已自动识别' : '已手动切换'
  if (isTouchMode) {
    badge.textContent = `📱 ${prefix}：手机/平板触屏模式 (点击可切键鼠)`
    badge.className = 'px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-sky-500/25 text-sky-200 border border-sky-400/50 hover:bg-sky-500/35 transition'
  } else {
    badge.textContent = `💻 ${prefix}：PC 键鼠操控模式 (点击可切触屏)`
    badge.className = 'px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition'
  }
}

export function setTouchLayerVisible(visible: boolean, isAuto = false): void {
  touchState.enabled = visible
  const layer = document.getElementById('touchControlsLayer')
  if (layer) layer.classList.toggle('hidden', !visible)
  updateInputModeBadge(visible, isAuto)
}

export function autoDetectDeviceInput(): void {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  const touchPoints = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
  setTouchLayerVisible(Boolean(coarse || (touchPoints && window.innerWidth <= 1024)), true)
}

