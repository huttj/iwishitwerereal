import type { BoardRecord, Diff, Store } from '@quickdrawjs/core'
import type { Attribution } from '../shared/types'

export type Attributed = BoardRecord & { meta?: Attribution }

export function attributionOf(rec: BoardRecord | undefined): Attribution | null {
  const meta = (rec as Attributed | undefined)?.meta
  return meta && (meta.createdBy || meta.editedBy) ? meta : null
}

/**
 * Stamps every local change with who made it. Runs as a store reactor, so
 * the stamp lands inside the same transaction (and undo step) as the change
 * itself, and travels with the record to everyone else. Remote diffs skip
 * reactors, so nobody rewrites anyone else's stamps.
 */
export function installAttribution(store: Store, userId: string): () => void {
  let current: Diff | null = null
  let now = 0
  const stamp = (rec: Attributed, meta: Attribution) => store.put({ ...rec, meta } as Attributed)
  return store.react((diff) => {
    // Reactors run repeatedly until nothing changes; one timestamp per transaction
    // keeps the second pass from seeing its own stamp as a fresh edit.
    if (diff !== current) {
      current = diff
      now = Date.now()
    }
    for (const rec of Object.values(diff.added) as Attributed[]) {
      if (rec.typeName !== 'shape' || rec.meta?.createdBy) continue
      stamp(rec, { ...rec.meta, createdBy: userId, createdAt: now, editedBy: userId, editedAt: now })
    }
    for (const [, [, to]] of Object.entries(diff.updated) as Array<[string, [Attributed, Attributed]]>) {
      if (to.typeName !== 'shape') continue
      if (to.meta?.editedBy === userId && to.meta.editedAt === now) continue
      stamp(to, { ...to.meta, editedBy: userId, editedAt: now })
    }
  })
}
