import { DurableObject } from 'cloudflare:workers'

/**
 * The room from the tldraw era. The class stays declared so its SQLite data
 * is kept; `dump()` hands it back for a one-off backup (see /api/admin/legacy/tldraw).
 * Once that content is no longer wanted, a `deleted_classes` migration in
 * wrangler.jsonc drops it and this file can go.
 */
export class TldrawDurableObject extends DurableObject<Env> {
  async dump(): Promise<Record<string, unknown[]>> {
    const sql = this.ctx.storage.sql
    const tables = sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .toArray()
      .map((r) => r.name)
    const out: Record<string, unknown[]> = {}
    for (const table of tables) {
      out[table] = sql.exec(`SELECT * FROM "${table.replace(/"/g, '""')}"`).toArray()
    }
    return out
  }

  fetch(): Response {
    return new Response('This room has moved on.', { status: 410 })
  }
}
