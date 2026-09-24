import { pageBounds, type Editor } from '@quickdrawjs/core'
import { useEffect, useRef, useState } from 'react'
import { attributionOf } from './attribution'
import { colorFor, nameOf, relativeTime, type People } from './people'

interface Info {
  x: number
  y: number
  createdBy: string | null
  editedBy: string | null
  createdAt: number | null
  editedAt: number | null
}

/**
 * Shows who made (and last edited) the hovered shape, pinned above its
 * top-left corner. Falls back to the single selected shape so it also works
 * on touch devices.
 */
export function AttributionOverlay({ editor, people, meId }: { editor: Editor; people: People; meId: string | null }) {
  const [info, setInfo] = useState<Info | null>(null)
  const hovered = useRef<string | null>(null)
  const lastKey = useRef('')

  useEffect(() => {
    const compute = () => {
      const selected = editor.selection.size === 1 ? [...editor.selection][0] : null
      const id = hovered.current ?? selected
      const shape = id ? editor.store.get(id) : undefined
      const editing = (editor as unknown as { editing: unknown }).editing
      const meta = shape && shape.typeName === 'shape' && !editing ? attributionOf(shape) : null
      let next: Info | null = null
      if (shape && shape.typeName === 'shape' && meta) {
        const b = pageBounds(shape)
        const s = editor.pageToScreen(b.x, b.y)
        next = {
          x: Math.round(s.x),
          y: Math.round(s.y),
          createdBy: meta.createdBy ?? null,
          editedBy: meta.editedBy && meta.editedBy !== meta.createdBy ? meta.editedBy : null,
          createdAt: meta.createdAt ?? null,
          editedAt: meta.editedAt ?? null,
        }
      }
      const key = next ? JSON.stringify(next) : ''
      if (key === lastKey.current) return
      lastKey.current = key
      setInfo(next)
    }

    const el = editor.container
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const r = el.getBoundingClientRect()
      const p = editor.screenToPage(e.clientX - r.left, e.clientY - r.top)
      const id = editor.hitTest(p.x, p.y)?.id ?? null
      if (id !== hovered.current) {
        hovered.current = id
        compute()
      }
    }
    const onLeave = () => {
      hovered.current = null
      compute()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    const offs = (['selection', 'camera', 'change', 'edit'] as const).map((ev) => editor.on(ev, compute))
    compute()
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      for (const off of offs) off()
    }
  }, [editor])

  if (!info) return null
  const who = info.createdBy ?? info.editedBy

  return (
    <div className="Attribution" style={{ transform: `translate(${info.x}px, ${info.y}px) translateY(calc(-100% - 6px))` }}>
      {who && people.get(who)?.avatar ? (
        <img className="Attribution-photo" src={people.get(who)!.avatar!} alt="" />
      ) : (
        <span className="Attribution-dot" style={{ background: who ? colorFor(who) : '#888' }} />
      )}
      <span>
        <strong>{nameOf(people, who, meId)}</strong>
        {info.createdAt && <span className="Attribution-time"> · {relativeTime(info.createdAt)}</span>}
      </span>
      {info.editedBy && (
        <span className="Attribution-edit">
          edited by <strong>{nameOf(people, info.editedBy, meId)}</strong>
          {info.editedAt && <span className="Attribution-time"> · {relativeTime(info.editedAt)}</span>}
        </span>
      )}
    </div>
  )
}
