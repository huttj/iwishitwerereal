import { FormEvent, useEffect, useState } from 'react'
import type { Me, UserSummary } from '../shared/types'
import { api, ApiError } from './api'
import { Avatar } from './Avatar'

export function Admin({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [users, setUsers] = useState<UserSummary[] | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!me.isAdmin) return
    api.admin
      .list()
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load users'))
  }, [me.isAdmin])

  if (!me.isAdmin) {
    return (
      <div className="Screen">
        <div className="Card">
          <h1 className="Wordmark">i wish it were real</h1>
          <p>This page is for admins.</p>
          <a className="Button" href="/">
            Back to the canvas
          </a>
        </div>
      </div>
    )
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await api.admin.add(email)
      setUsers((prev) => {
        const rest = (prev ?? []).filter((u) => u.email !== user.email)
        return [...rest, user]
      })
      setEmail('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add')
    } finally {
      setBusy(false)
    }
  }

  async function remove(u: UserSummary) {
    if (!confirm(`Remove ${u.email}? They will be signed out and unable to sign in again.`)) return
    setError(null)
    try {
      await api.admin.remove(u.email)
      setUsers((prev) => (prev ?? []).filter((x) => x.email !== u.email))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove')
    }
  }

  return (
    <div className="Screen Screen--top">
      <div className="Card Card--wide">
        <header className="AdminHeader">
          <h1 className="Wordmark">people</h1>
          <nav className="AdminNav">
            <a href="/">Canvas</a>
            <button className="Link" onClick={onSignOut}>
              Sign out
            </button>
          </nav>
        </header>

        <form onSubmit={add} className="Form Form--row">
          <input
            className="Input"
            type="email"
            placeholder="friend@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
          <button className="Button" type="submit" disabled={busy || !email}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
        <p className="Muted">Anyone on this list can request a sign-in link. They pick their own name on first sign-in.</p>
        {error && <p className="Error">{error}</p>}

        {users === null ? (
          <p className="Muted">Loading…</p>
        ) : (
          <table className="Table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Last sign-in</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email}>
                  <td>
                    {u.email}
                    {u.isAdmin && <span className="Tag">admin</span>}
                  </td>
                  <td className="Table-person">
                    <Avatar id={u.id} name={u.name ?? '?'} avatar={u.avatar} className="Avatar--small" />
                    {u.name ?? <span className="Muted">—</span>}
                  </td>
                  <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : <span className="Muted">never</span>}</td>
                  <td className="Table-actions">
                    {!u.isAdmin && (
                      <button className="Link Link--danger" onClick={() => remove(u)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
