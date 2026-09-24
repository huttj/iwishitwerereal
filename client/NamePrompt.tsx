import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'
import { prepareAvatar } from './avatarImage'

export function NamePrompt({ onDone }: { onDone: (me: Me) => void }) {
  const [name, setName] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!photo) return setPreview(null)
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  async function choosePhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      setPhoto(await prepareAvatar(file))
    } catch {
      setError('Could not read that image.')
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      let me = await api.setName(name)
      if (photo) me = await api.setAvatar(photo)
      onDone(me)
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
          <label className="PhotoPick">
            {preview ? <img className="PhotoPick-preview" src={preview} alt="" /> : <span className="PhotoPick-empty" />}
            <span>
              {preview ? 'Change photo' : 'Add a photo'} <span className="Muted">(optional)</span>
            </span>
            <input type="file" accept="image/*" hidden onChange={choosePhoto} disabled={busy} />
          </label>
          <button className="Button" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
          {error && <p className="Error">{error}</p>}
        </form>
      </div>
    </div>
  )
}
