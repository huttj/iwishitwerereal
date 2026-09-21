import { FormEvent, useState } from 'react'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'

export function NamePrompt({ onDone }: { onDone: (me: Me) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone(await api.setName(name))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div className="Screen">
      <div className="Card">
        <h1 className="Wordmark">i wish it were real</h1>
        <form onSubmit={submit} className="Form">
          <p>What should we call you? This shows up next to the things you add.</p>
          <input
            className="Input"
            type="text"
            name="name"
            autoComplete="nickname"
            placeholder="Your name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            disabled={busy}
          />
          <button className="Button" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
          {error && <p className="Error">{error}</p>}
        </form>
      </div>
    </div>
  )
}
