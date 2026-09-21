import { useSync } from '@tldraw/sync'
import { useMemo } from 'react'
import {
  computed,
  createUserId,
  Editor,
  TLComponents,
  Tldraw,
  TLUserStore,
  UserRecordType,
} from 'tldraw'
import type { Me } from '../shared/types'
import { AttributionOverlay } from './AttributionOverlay'
import { getBookmarkPreview } from './getBookmarkPreview'
import { multiplayerAssetStore } from './multiplayerAssetStore'
import { TopBar } from './TopBar'

const ROOM_ID = 'main'

const USER_COLORS = ['#FF802B', '#EC5E41', '#F2555A', '#F04F88', '#E34BA9', '#BD54C6', '#9D5BD2', '#7B66DC', '#02B1CC', '#11B3A3', '#39B178', '#55B467']

function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return USER_COLORS[h % USER_COLORS.length]
}

/** `me` is null for anonymous viewers: the server gives them a read-only session. */
export function Canvas({ me, onSignOut }: { me: Me | null; onSignOut: () => void }) {
  const users = useMemo<TLUserStore>(() => {
    const currentUser = computed('currentUser', () =>
      me
        ? UserRecordType.create({
            id: createUserId(me.id),
            name: me.name ?? me.email,
            color: colorFor(me.id),
          })
        : null
    )
    return { currentUser }
  }, [me])

  const store = useSync({
    uri: `${window.location.origin}/api/connect/${ROOM_ID}`,
    assets: multiplayerAssetStore,
    users,
    // Viewers are invisible: no cursor, no entry in the people menu.
    getUserPresence: me ? undefined : () => null,
  })

  const components = useMemo<TLComponents>(
    () => ({
      InFrontOfTheCanvas: AttributionOverlay,
      SharePanel: () => <TopBar me={me} onSignOut={onSignOut} />,
    }),
    [me, onSignOut]
  )

  return (
    <div className="CanvasRoot">
      <Tldraw
        licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
        store={store}
        components={components}
        options={{ deepLinks: true }}
        onMount={(editor) => setupEditor(editor, me)}
      />
    </div>
  )
}

function setupEditor(editor: Editor, me: Me | null) {
  if (import.meta.env.DEV) (window as unknown as { editor: Editor }).editor = editor

  if (!me) {
    // The server already refuses writes from this session; this hides the edit tools too.
    editor.updateInstanceState({ isReadonly: true })
    return
  }

  editor.registerExternalAssetHandler('url', getBookmarkPreview)

  // Keep the local user preferences in step with the signed-in identity so the
  // people menu and cursor labels agree with the attribution labels.
  editor.user.updateUserPreferences({ name: me.name ?? me.email, color: colorFor(me.id) })

  // Every new shape is stamped with who made it.
  editor.getInitialMetaForShape = () => ({
    createdBy: editor.getAttributionUserId() ?? me.id,
    createdAt: Date.now(),
  })

  // Edits made locally stamp the editor. Remote changes pass through untouched,
  // otherwise every client would rewrite everyone else's shapes.
  editor.sideEffects.registerBeforeChangeHandler('shape', (prev, next, source) => {
    if (source !== 'user') return next
    if (prev === next) return next
    const userId = editor.getAttributionUserId()
    if (!userId) return next
    if (next.meta.editedBy === userId && typeof next.meta.editedAt === 'number' && Date.now() - next.meta.editedAt < 1000) return next
    return { ...next, meta: { ...next.meta, editedBy: userId, editedAt: Date.now() } }
  })
}
