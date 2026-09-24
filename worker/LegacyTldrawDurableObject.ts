import { DurableObject } from 'cloudflare:workers'
import type { LegacyRecord } from '../shared/types'

/**
 * The room from the tldraw era. The class stays declared so its SQLite data
 * is kept; `records()` hands it back so the admin page can convert it onto
 * the Quickdraw board (see /api/admin/legacy/tldraw). Once that content is
 * no longer wanted, a `deleted_classes` migration in wrangler.jsonc drops it
 * and this file can go.
 */
export class TldrawDurableObject extends DurableObject<Env> {
  async records(): Promise<LegacyRecord[]> {
    const sql = this.ctx.storage.sql
    const hasTable = sql
      .exec<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'documents'")
      .one().n
    if (!hasTable) return []
    const decoder = new TextDecoder()
    const out: LegacyRecord[] = []
    for (const row of sql.exec<{ state: ArrayBuffer | string }>('SELECT state FROM documents')) {
      const text = typeof row.state === 'string' ? row.state : decoder.decode(row.state)
      try {
        const rec = JSON.parse(text) as LegacyRecord
        if (rec && typeof rec.id === 'string' && typeof rec.typeName === 'string') out.push(rec)
      } catch {
        /* not a record we can read */
      }
    }
    return out
  }

  fetch(): Response {
    return new Response('This room has moved on.', { status: 410 })
  }
}
