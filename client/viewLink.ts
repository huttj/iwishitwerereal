import type { Editor } from '@quickdrawjs/core'

/** A shareable view: the page point at the middle of the screen, plus zoom. */
export interface View {
  x: number
  y: number
  z: number
}

const VIEW_RE = /^#v=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/

export function parseView(hash: string): View | null {
  const m = VIEW_RE.exec(hash)
  if (!m) return null
  const view = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }
  return Number.isFinite(view.x) && Number.isFinite(view.y) && view.z > 0 ? view : null
}

export function currentView(editor: Editor): View {
  const { w, h } = editor.viewSize()
  const c = editor.screenToPage(w / 2, h / 2)
  return { x: c.x, y: c.y, z: editor.camera.z }
}

export function formatView(view: View) {
  return `#v=${view.x.toFixed(1)},${view.y.toFixed(1)},${view.z.toFixed(3)}`
}

export function applyView(editor: Editor, view: View) {
  const { w, h } = editor.viewSize()
  editor.setCamera({ x: w / (2 * view.z) - view.x, y: h / (2 * view.z) - view.y, z: view.z })
}

export function viewLink(editor: Editor) {
  return `${window.location.origin}/${formatView(currentView(editor))}`
}

/** Mirrors the camera into the URL hash (throttled) so the address bar is always a deep link. */
export function mirrorViewToHash(editor: Editor) {
  let timer = 0
  const write = () => {
    timer = 0
    const hash = formatView(currentView(editor))
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
  }
  return editor.on('camera', () => {
    if (!timer) timer = window.setTimeout(write, 250)
  })
}
