// web/fullscreen.ts —— 全屏 API + canvas 视口适配（浏览器，零依赖）
export function isFullscreen(): boolean {
  const d = document as unknown as {
    fullscreenElement?: Element | null
    webkitFullscreenElement?: Element | null
  }
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement)
}

export function toggleFullscreen(): void {
  const el = document.documentElement as unknown as {
    requestFullscreen?: () => Promise<void>
    webkitRequestFullscreen?: () => void
  }
  const d = document as unknown as {
    exitFullscreen?: () => Promise<void>
    webkitExitFullscreen?: () => void
  }
  if (isFullscreen()) {
    ;(d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
  } else {
    ;(el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())
  }
}

export interface Viewport {
  /** 屏幕(px) → 逻辑世界坐标 */
  toWorld: (clientX: number, clientY: number) => { x: number; y: number }
  /** 每帧渲染前应调用的 transform 设置（含 DPR 缩放） */
  applyTransform: () => void
}

/**
 * 把 canvas 铺满窗口；内部分辨率 = logical × devicePixelRatio；
 * 返回坐标换算与每帧 transform 设置。监听 resize/orientationchange。
 */
export function fitCanvas(canvas: HTMLCanvasElement, logicalW: number, logicalH: number): Viewport {
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1

  const resize = (): void => {
    canvas.width = Math.max(1, Math.round(logicalW * dpr))
    canvas.height = Math.max(1, Math.round(logicalH * dpr))
    canvas.style.width = '100%'
    canvas.style.height = '100%'
  }
  resize()
  window.addEventListener('resize', resize)
  window.addEventListener('orientationchange', resize)

  document.body.style.touchAction = 'none'
  document.body.style.overflow = 'hidden'

  return {
    toWorld: (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: ((clientX - rect.left) / rect.width) * logicalW,
        y: ((clientY - rect.top) / rect.height) * logicalH,
      }
    },
    applyTransform: () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    },
  }
}
