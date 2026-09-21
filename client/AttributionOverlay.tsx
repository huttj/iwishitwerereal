import { useEditor, useValue } from 'tldraw'

function relativeTime(ts: number) {
  const diff = Date.now() - ts
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

/**
 * Shows who made (and last edited) the hovered shape, pinned above its top-left corner.
 * Falls back to the single selected shape so it also works on touch devices.
 */
export function AttributionOverlay() {
  const editor = useEditor()

  const info = useValue(
    'attribution',
    () => {
      const shape = editor.getHoveredShape() ?? editor.getOnlySelectedShape()
      if (!shape) return null
      if (editor.getEditingShapeId() === shape.id) return null
      const bounds = editor.getShapePageBounds(shape)
      if (!bounds) return null
      const createdBy = typeof shape.meta.createdBy === 'string' ? shape.meta.createdBy : null
      const editedBy = typeof shape.meta.editedBy === 'string' ? shape.meta.editedBy : null
      const createdAt = typeof shape.meta.createdAt === 'number' ? shape.meta.createdAt : null
      const editedAt = typeof shape.meta.editedAt === 'number' ? shape.meta.editedAt : null
      if (!createdBy && !editedBy) return null
      const point = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
      const creatorName = editor.getAttributionDisplayName(createdBy) ?? 'someone'
      const editorName = editedBy && editedBy !== createdBy ? editor.getAttributionDisplayName(editedBy) : null
      const color = editor.getAttributionUser(createdBy ?? editedBy)?.color ?? '#888'
      return { x: point.x, y: point.y, creatorName, editorName, createdAt, editedAt, color }
    },
    [editor]
  )

  if (!info) return null

  return (
    <div
      className="Attribution"
      style={{ transform: `translate(${Math.round(info.x)}px, ${Math.round(info.y)}px) translateY(calc(-100% - 6px))` }}
    >
      <span className="Attribution-dot" style={{ background: info.color }} />
      <span>
        <strong>{info.creatorName}</strong>
        {info.createdAt && <span className="Attribution-time"> · {relativeTime(info.createdAt)}</span>}
      </span>
      {info.editorName && (
        <span className="Attribution-edit">
          edited by <strong>{info.editorName}</strong>
          {info.editedAt && <span className="Attribution-time"> · {relativeTime(info.editedAt)}</span>}
        </span>
      )}
    </div>
  )
}
