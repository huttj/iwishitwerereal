import { DurableObject } from 'cloudflare:workers'
import type { UserSummary } from '../shared/types'

const TOKEN_TTL_MS = 15 * 60 * 1000
const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000
const TOKEN_MIN_INTERVAL_MS = 30 * 1000

type UserRow = {
  id: string
  email: string
  name: string | null
  added_by: string | null
  added_at: number
  last_login_at: number | null
}

export interface SessionInfo {
  id: string
  email: string
  name: string | null
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

function base64url(buf: Uint8Array) {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return base64url(new Uint8Array(digest))
}

/**
 * Single-instance Durable Object holding the allowlist, login tokens and sessions.
 * SQLite-backed, so it needs no provisioning beyond the worker deploy itself.
 */
export class AuthDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => this.migrate())
  }

  private migrate() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        added_by TEXT,
        added_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS login_tokens (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS login_tokens_email ON login_tokens(email);
      CREATE TABLE IF NOT EXISTS sessions (
        id_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_email ON sessions(email);
    `)
  }

  private isAdmin(email: string) {
    return this.env.ADMIN_EMAILS.split(',')
      .map(normalizeEmail)
      .filter(Boolean)
      .includes(normalizeEmail(email))
  }

  private getUserRow(email: string): UserRow | null {
    const rows = this.ctx.storage.sql
      .exec<UserRow>('SELECT * FROM users WHERE email = ?', normalizeEmail(email))
      .toArray()
    return rows[0] ?? null
  }

  private toSummary(row: UserRow): UserSummary {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      isAdmin: this.isAdmin(row.email),
      addedBy: row.added_by,
      addedAt: row.added_at,
      lastLoginAt: row.last_login_at,
    }
  }

  /** Admins are always allowed; everyone else must be on the list. */
  async isAllowed(email: string): Promise<boolean> {
    const norm = normalizeEmail(email)
    if (this.isAdmin(norm)) {
      this.ensureUser(norm, null)
      return true
    }
    return this.getUserRow(norm) !== null
  }

  private ensureUser(email: string, addedBy: string | null): UserRow {
    const existing = this.getUserRow(email)
    if (existing) return existing
    const row: UserRow = {
      id: randomToken(12),
      email: normalizeEmail(email),
      name: null,
      added_by: addedBy,
      added_at: Date.now(),
      last_login_at: null,
    }
    this.ctx.storage.sql.exec(
      'INSERT INTO users (id, email, name, added_by, added_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)',
      row.id,
      row.email,
      row.name,
      row.added_by,
      row.added_at,
      row.last_login_at
    )
    return row
  }

  /** Returns a one-time login token, or null if one was issued too recently. */
  async createLoginToken(email: string): Promise<{ token: string } | { retryInMs: number }> {
    const norm = normalizeEmail(email)
    const now = Date.now()
    const recent = this.ctx.storage.sql
      .exec<{ created_at: number }>(
        'SELECT created_at FROM login_tokens WHERE email = ? ORDER BY created_at DESC LIMIT 1',
        norm
      )
      .toArray()[0]
    if (recent && now - recent.created_at < TOKEN_MIN_INTERVAL_MS) {
      return { retryInMs: TOKEN_MIN_INTERVAL_MS - (now - recent.created_at) }
    }
    this.ctx.storage.sql.exec('DELETE FROM login_tokens WHERE expires_at < ?', now)
    const token = randomToken(32)
    this.ctx.storage.sql.exec(
      'INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)',
      await sha256(token),
      norm,
      now,
      now + TOKEN_TTL_MS
    )
    return { token }
  }

  /** Consumes a login token and opens a session. Returns null if invalid. */
  async redeemLoginToken(token: string): Promise<{ sessionId: string; email: string } | null> {
    const hash = await sha256(token)
    const now = Date.now()
    const row = this.ctx.storage.sql
      .exec<{ email: string; expires_at: number; used_at: number | null }>(
        'SELECT email, expires_at, used_at FROM login_tokens WHERE token_hash = ?',
        hash
      )
      .toArray()[0]
    if (!row || row.used_at !== null || row.expires_at < now) return null
    if (!(await this.isAllowed(row.email))) return null

    this.ctx.storage.sql.exec('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?', now, hash)
    this.ctx.storage.sql.exec('UPDATE users SET last_login_at = ? WHERE email = ?', now, row.email)

    const sessionId = randomToken(32)
    this.ctx.storage.sql.exec(
      'INSERT INTO sessions (id_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)',
      await sha256(sessionId),
      row.email,
      now,
      now + SESSION_TTL_MS
    )
    return { sessionId, email: row.email }
  }

  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const hash = await sha256(sessionId)
    const now = Date.now()
    const row = this.ctx.storage.sql
      .exec<{ email: string; expires_at: number }>(
        'SELECT email, expires_at FROM sessions WHERE id_hash = ?',
        hash
      )
      .toArray()[0]
    if (!row || row.expires_at < now) return null
    const user = this.getUserRow(row.email)
    if (!user) return null
    return { id: user.id, email: user.email, name: user.name }
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE id_hash = ?', await sha256(sessionId))
  }

  async setName(email: string, name: string): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE users SET name = ? WHERE email = ?', name, normalizeEmail(email))
  }

  async listUsers(): Promise<UserSummary[]> {
    return this.ctx.storage.sql
      .exec<UserRow>('SELECT * FROM users ORDER BY added_at ASC')
      .toArray()
      .map((r) => this.toSummary(r))
  }

  async addUser(email: string, addedBy: string): Promise<UserSummary> {
    return this.toSummary(this.ensureUser(email, addedBy))
  }

  /** Removes a user and revokes their sessions. Admins cannot be removed. */
  async removeUser(email: string): Promise<boolean> {
    const norm = normalizeEmail(email)
    if (this.isAdmin(norm)) return false
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE email = ?', norm)
    this.ctx.storage.sql.exec('DELETE FROM login_tokens WHERE email = ?', norm)
    const result = this.ctx.storage.sql.exec('DELETE FROM users WHERE email = ?', norm)
    return result.rowsWritten > 0
  }
}
