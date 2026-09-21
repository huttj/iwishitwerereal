import { useEffect, useState } from 'react'
import { useEditor } from 'tldraw'
import type { Me } from '../shared/types'

/** Replaces tldraw's share panel: copy-a-link-to-this-view, admin link, sign out. */
export function TopBar({ me, onSignOut }: { me: Me | null; onSignOut: () => void }) {
  const editor = useEditor()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  async function copyViewLink() {
    const url = editor.createDeepLink({ url: `${window.location.origin}/` })
    await navigator.clipboard.writeText(url.toString())
    setCopied(true)
  }

  return (
    <div className="TopBar" onPointerDown={(e) => e.stopPropagation()}>
      <button className="TopBar-button" onClick={copyViewLink} title="Copy a link that opens the canvas at exactly this view">
        {copied ? 'Copied!' : 'Copy link to view'}
      </button>
      {me ? (
      <div className="TopBar-menu">
        <button className="TopBar-button TopBar-button--quiet">{me.name}</button>
        <div className="TopBar-dropdown">
          {me.isAdmin && (
            <a className="TopBar-item" href="/admin">
              People
            </a>
          )}
          <button className="TopBar-item" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
      ) : (
        <a className="TopBar-button TopBar-button--primary" href="/login">
          Sign in to edit
        </a>
      )}
    </div>
  )
}
