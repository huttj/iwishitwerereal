import type { BoardRecord, ScribbleStroke } from '@quickdrawjs/core'

/**
 * What travels over the room socket. Quickdraw records are whole and
 * last-writer-wins, so an update is just a put and a removal is just an id.
 * That halves the traffic of Quickdraw's native [from, to] diffs.
 */
export interface WireDiff {
  put: Record<string, BoardRecord>
  removed: string[]
}

export interface Cursor {
  x: number
  y: number
}

/** A signed-in editor in the room. Viewers are invisible. */
export interface Peer {
  sessionId: string
  userId: string
  cursor: Cursor | null
}

export type ClientMessage =
  | { type: 'diff'; diff: WireDiff }
  | { type: 'cursor'; cursor: Cursor | null }
  | { type: 'laser'; strokes: ScribbleStroke[] }
  | { type: 'ping' }

export type ServerMessage =
  /** Handshake: the document follows in `records` chunks, then `ready`. */
  | { type: 'init'; sessionId: string; readonly: boolean; count: number }
  | { type: 'records'; records: BoardRecord[] }
  | { type: 'ready'; peers: Peer[] }
  | { type: 'diff'; diff: WireDiff }
  | { type: 'peer'; peer: Peer }
  | { type: 'leave'; sessionId: string }
  | { type: 'laser'; sessionId: string; strokes: ScribbleStroke[] }
  | { type: 'rejected'; reason: string }
  | { type: 'pong' }
