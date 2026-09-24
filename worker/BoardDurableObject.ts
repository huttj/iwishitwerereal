import { DurableObject } from 'cloudflare:workers'
import type { BoardRecord, ScribbleStroke } from '@quickdrawjs/core'
import type { ClientMessage, Cursor, Peer, ServerMessage, WireDiff } from '../shared/protocol'

/** Set by the worker (never trusted from the client). */
export const READONLY_HEADER = 'x-iwir-readonly'
export const USER_HEADER = 'x-iwir-user'

interface Attachment {
  sessionId: string
  userId: string | null
  readonly: boolean
}

const MAX_RECORD_CHARS = 256 * 1024
const MAX_RECORDS_PER_MESSAGE = 2000
const INIT_CHUNK_CHARS = 400 * 1024
const MAX_ID_CHARS = 96

/**
 * One board per Durable Object. The document is a flat map of Quickdraw
 * records in SQLite; every accepted diff is written through and relayed to
 * the other sockets. Uses WebSocket hibernation, so an idle room costs nothing.
 */
export class BoardDurableObject extends DurableObject<Env> {
  /** Live cursors, by session. In memory only: they are rebuilt on the next move. */
  private cursors = new Map<string, Cursor | null>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => this.migrate())
    // Keepalive pings are answered at the platform layer without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))
  }

  private migrate() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a websocket', { status: 426 })
    }
    const readonly = request.headers.get(READONLY_HEADER) !== '0'
    const userId = readonly ? null : request.headers.get(USER_HEADER)
    if (!readonly && !userId) return new Response('Missing user', { status: 400 })

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const attachment: Attachment = { sessionId: crypto.randomUUID(), userId, readonly }
    server.serializeAttachment(attachment)
    this.ctx.acceptWebSocket(server)

    this.sendDocument(server, attachment)
    if (!readonly) {
      this.broadcast({ type: 'peer', peer: this.peerOf(attachment) }, server)
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  // ---- handshake ----

  private sendDocument(ws: WebSocket, attachment: Attachment) {
    const rows = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM records').toArray()
    this.send(ws, { type: 'init', sessionId: attachment.sessionId, readonly: attachment.readonly, count: rows.length })

    // Records are stored as JSON text, so chunks are spliced together rather
    // than parsed and re-serialized.
    let chunk: string[] = []
    let chars = 0
    const flush = () => {
      if (!chunk.length) return
      ws.send(`{"type":"records","records":[${chunk.join(',')}]}`)
      chunk = []
      chars = 0
    }
    for (const row of rows) {
      chunk.push(row.data)
      chars += row.data.length
      if (chars >= INIT_CHUNK_CHARS) flush()
    }
    flush()

    this.send(ws, { type: 'ready', peers: this.peers(ws) })
  }

  private peerOf(attachment: Attachment): Peer {
    return {
      sessionId: attachment.sessionId,
      userId: attachment.userId ?? '',
      cursor: this.cursors.get(attachment.sessionId) ?? null,
    }
  }

  private peers(except: WebSocket): Peer[] {
    const out: Peer[] = []
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      const attachment = getAttachment(ws)
      if (!attachment || attachment.readonly) continue
      out.push(this.peerOf(attachment))
    }
    return out
  }

  // ---- messages ----

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    const attachment = getAttachment(ws)
    if (!attachment) return

    let msg: ClientMessage
    try {
      msg = JSON.parse(message) as ClientMessage
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    switch (msg.type) {
      case 'ping':
        this.send(ws, { type: 'pong' })
        return

      case 'diff': {
        if (attachment.readonly) {
          this.send(ws, { type: 'rejected', reason: 'Sign in to edit' })
          return
        }
        const diff = sanitizeDiff(msg.diff)
        if (!diff) {
          this.send(ws, { type: 'rejected', reason: 'Malformed change' })
          return
        }
        this.applyDiff(diff)
        this.broadcast({ type: 'diff', diff }, ws)
        return
      }

      case 'cursor': {
        if (attachment.readonly) return
        const cursor = sanitizeCursor(msg.cursor)
        this.cursors.set(attachment.sessionId, cursor)
        this.broadcast({ type: 'peer', peer: this.peerOf(attachment) }, ws)
        return
      }

      case 'laser': {
        if (attachment.readonly) return
        const strokes = sanitizeStrokes(msg.strokes)
        if (!strokes) return
        this.broadcast({ type: 'laser', sessionId: attachment.sessionId, strokes }, ws)
        return
      }
    }
  }

  override async webSocketClose(ws: WebSocket) {
    this.handleLeave(ws)
  }

  override async webSocketError(ws: WebSocket) {
    this.handleLeave(ws)
  }

  private handleLeave(ws: WebSocket) {
    const attachment = getAttachment(ws)
    if (!attachment) return
    this.cursors.delete(attachment.sessionId)
    if (!attachment.readonly) this.broadcast({ type: 'leave', sessionId: attachment.sessionId }, ws)
  }

  // ---- document ----

  private applyDiff(diff: WireDiff) {
    const sql = this.ctx.storage.sql
    this.ctx.storage.transactionSync(() => {
      for (const rec of Object.values(diff.put)) {
        sql.exec('INSERT OR REPLACE INTO records (id, data) VALUES (?, ?)', rec.id, JSON.stringify(rec))
      }
      for (const id of diff.removed) {
        sql.exec('DELETE FROM records WHERE id = ?', id)
      }
    })
  }

  // ---- sockets ----

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* the socket is on its way out */
    }
  }

  private broadcast(msg: ServerMessage, except: WebSocket | null) {
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      try {
        ws.send(data)
      } catch {
        /* the socket is on its way out */
      }
    }
  }
}

function getAttachment(ws: WebSocket): Attachment | null {
  const attachment = ws.deserializeAttachment() as Attachment | null
  return attachment?.sessionId ? attachment : null
}

// ---- validation: never trust a record from the network ----

function isFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function isId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS
}

function sanitizeRecord(value: unknown): BoardRecord | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (!isId(rec.id)) return null
  if (rec.typeName === 'asset') {
    // Images live in R2; the client uploads before it syncs. Refusing anything
    // else keeps data URLs out of the document and third-party URLs off viewers' screens.
    if (typeof rec.src !== 'string' || !rec.src.startsWith('/api/uploads/') || rec.src.length > 512) return null
  } else if (rec.typeName !== 'shape') {
    return null
  }
  if (JSON.stringify(rec).length > MAX_RECORD_CHARS) return null
  return rec as unknown as BoardRecord
}

function sanitizeDiff(value: unknown): WireDiff | null {
  if (!value || typeof value !== 'object') return null
  const { put, removed } = value as { put?: unknown; removed?: unknown }
  if (!put || typeof put !== 'object' || !Array.isArray(removed)) return null
  const entries = Object.entries(put as Record<string, unknown>)
  if (entries.length + removed.length > MAX_RECORDS_PER_MESSAGE) return null
  const out: WireDiff = { put: {}, removed: [] }
  for (const [id, raw] of entries) {
    const rec = sanitizeRecord(raw)
    if (!rec || rec.id !== id) return null
    out.put[id] = rec
  }
  for (const id of removed) {
    if (!isId(id)) return null
    out.removed.push(id)
  }
  return out
}

function sanitizeCursor(value: unknown): Cursor | null {
  if (!value || typeof value !== 'object') return null
  const { x, y } = value as { x?: unknown; y?: unknown }
  return isFinite(x) && isFinite(y) ? { x, y } : null
}

function sanitizeStrokes(value: unknown): ScribbleStroke[] | null {
  if (!Array.isArray(value) || value.length > 12) return null
  const out: ScribbleStroke[] = []
  for (const stroke of value) {
    if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points) || stroke.points.length > 240) return null
    const points: Array<{ x: number; y: number }> = []
    for (const p of stroke.points) {
      if (!p || !isFinite(p.x) || !isFinite(p.y)) return null
      points.push({ x: p.x, y: p.y })
    }
    const opacity = isFinite(stroke.opacity) ? Math.max(0, Math.min(1, stroke.opacity)) : 1
    out.push({ points, opacity })
  }
  return out
}
