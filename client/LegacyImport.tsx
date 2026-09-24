import { convertTldrawContent, type BoardRecord } from '@quickdrawjs/core'
import { useEffect, useState } from 'react'
import type { Attribution, LegacyRecord } from '../shared/types'
import { api, ApiError } from './api'

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; records: BoardRecord[]; shapes: number; images: number; skipped: Record<string, number> }
  | { kind: 'importing' }
  | { kind: 'done'; imported: number; rejected: number }
  | { kind: 'error'; message: string }

/** The old tldraw board, converted with Quickdraw's own importer, one click from the new board. */
export function LegacyImport() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    api.admin
      .legacyRecords()
      .then((records) => setState(prepare(records)))
      .catch((e) => setState({ kind: 'error', message: e instanceof ApiError ? e.message : 'Could not read the old board.' }))
  }, [])

  async function run() {
    if (state.kind !== 'ready') return
    const { records } = state
    setState({ kind: 'importing' })
    try {
      setState({ kind: 'done', ...(await api.admin.importLegacy(records)) })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof ApiError ? e.message : 'Import failed.' })
    }
  }

  if (state.kind === 'empty') return null

  return (
    <section className="Legacy">
      <h2 className="Legacy-title">The old tldraw board</h2>
      {state.kind === 'loading' && <p className="Muted">Reading…</p>}
      {state.kind === 'error' && <p className="Error">{state.message}</p>}
      {state.kind === 'ready' && (
        <>
          <p>
            It still holds <strong>{state.shapes}</strong> shapes and <strong>{state.images}</strong> images. Importing puts them on the new board
            with their original authors. Shapes keep their ids, so running this again replaces rather than duplicates them.
          </p>
          {Object.keys(state.skipped).length > 0 && (
            <p className="Muted">
              No Quickdraw equivalent, will be left behind:{' '}
              {Object.entries(state.skipped)
                .map(([type, n]) => `${n} ${type}`)
                .join(', ')}
              .
            </p>
          )}
          <button className="Button" onClick={run} disabled={state.records.length === 0}>
            Import onto the board
          </button>
        </>
      )}
      {state.kind === 'importing' && <p className="Muted">Importing…</p>}
      {state.kind === 'done' && (
        <p>
          Imported <strong>{state.imported}</strong> records{state.rejected > 0 && <>, {state.rejected} were refused by the room</>}. Open the canvas
          and zoom to fit (⇧1).
        </p>
      )}
    </section>
  )
}

function prepare(records: LegacyRecord[]): State {
  const shapes = records.filter((r) => r.typeName === 'shape')
  if (!shapes.length) return { kind: 'empty' }
  const content = {
    shapes,
    bindings: records.filter((r) => r.typeName === 'binding'),
    assets: records.filter((r) => r.typeName === 'asset'),
  }
  const converted = convertTldrawContent(content)
  const byId = new Map(shapes.map((s) => [s.id, s]))
  const out: BoardRecord[] = []
  for (const shape of converted.shapes) {
    const meta = attributionOf(byId.get(shape.id)?.meta)
    out.push(meta ? ({ ...shape, meta } as BoardRecord) : shape)
  }
  const used = new Set(out.map((s) => (s.typeName === 'shape' ? s.props.assetId : null)).filter(Boolean))
  for (const asset of converted.assets) if (used.has(asset.id)) out.push(asset)

  const kept = new Set(converted.shapes.map((s) => s.id))
  const skipped: Record<string, number> = {}
  for (const s of shapes) {
    if (kept.has(s.id) || s.type === 'group') continue
    const type = typeof s.type === 'string' ? s.type : 'unknown'
    skipped[type] = (skipped[type] ?? 0) + 1
  }
  return { kind: 'ready', records: out, shapes: converted.shapes.length, images: out.length - converted.shapes.length, skipped }
}

/** tldraw stamped `user:<id>`; our ids are bare. */
function attributionOf(meta: unknown): Attribution | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  const id = (v: unknown) => (typeof v === 'string' ? v.replace(/^user:/, '') : undefined)
  const at = (v: unknown) => (typeof v === 'number' ? v : undefined)
  const out: Attribution = { createdBy: id(m.createdBy), createdAt: at(m.createdAt), editedBy: id(m.editedBy), editedAt: at(m.editedAt) }
  return out.createdBy || out.editedBy ? out : null
}
