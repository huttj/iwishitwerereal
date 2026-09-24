import { Quickdraw, useQuickdrawStore, type Editor, type GridId, type ThemeId } from '@quickdrawjs/react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Peer } from '../shared/protocol'
import type { Me } from '../shared/types'
import { api } from './api'
import { installAttribution } from './attribution'
import { AttributionOverlay } from './AttributionOverlay'
import { Cursors } from './Cursors'
import type { People } from './people'
import { BoardSync, type SyncStatus } from './sync'
import { TopBar } from './TopBar'
import { applyView, mirrorViewToHash, parseView } from './viewLink'

const ROOM_ID = 'main'
const GRIDS: GridId[] = ['none', 'lines', 'ruled', 'dots', 'crosses', 'iso']

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

function socketUrl(roomId: string) {
  return `${window.location.origin.replace(/^http/, 'ws')}/api/connect/${roomId}`
}

/** `me` is null for anonymous viewers: they can look around but the room refuses their edits. */
export function Canvas({ me, onMeChange, onSignOut }: { me: Me | null; onMeChange?: (me: Me) => void; onSignOut: () => void }) {
  const store = useQuickdrawStore()
  const editorRef = useRef<Editor | null>(null)
  const syncRef = useRef<BoardSync | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [theme, setTheme] = useState<ThemeId>(() =>
    readPref('iwir:theme', ['light', 'dark'], window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )
  const [grid, setGrid] = useState<GridId>(() => readPref('iwir:grid', GRIDS, 'lines'))
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [peers, setPeers] = useState<Peer[]>([])
  const [people, setPeople] = useState<People>(() => new Map())

  // The link we arrived on, read once: the hash is rewritten as the camera moves.
  const initialView = useMemo(() => parseView(window.location.hash), [])
  const framed = useRef(false)

  const loadPeople = useCallback(() => {
    api
      .people()
      .then((list) => setPeople(new Map(list.map((p) => [p.id, p]))))
      .catch(() => {})
  }, [])

  // Refetched when your own photo changes so your labels show it right away.
  useEffect(loadPeople, [loadPeople, me?.avatar])

  // Someone new signed in since the directory was fetched: fetch it again, once per id.
  const lookedUp = useRef(new Set<string>())
  useEffect(() => {
    const unknown = peers.filter((p) => !people.has(p.userId) && !lookedUp.current.has(p.userId))
    if (!unknown.length) return
    for (const p of unknown) lookedUp.current.add(p.userId)
    loadPeople()
  }, [peers, people, loadPeople])

  useEffect(() => (me ? installAttribution(store, me.id) : undefined), [store, me])

  // First look at the document: the deep link wins, otherwise fit what is there.
  const frame = useCallback(
    (ed: Editor) => {
      if (framed.current) return
      framed.current = true
      if (initialView) applyView(ed, initialView)
      else if (store.shapes().length) ed.fitContent({ maxZoom: 1 })
    },
    [initialView, store]
  )

  useEffect(() => {
    const sync = new BoardSync(store, socketUrl(ROOM_ID), {
      canEdit: !!me,
      onStatus: setStatus,
      onPeers: setPeers,
      onLaser: (strokes) => editorRef.current?.setRemoteScribbles(strokes),
      onReady: (first) => {
        if (first && editorRef.current) frame(editorRef.current)
      },
    })
    syncRef.current = sync
    sync.connect()
    return () => {
      sync.close()
      syncRef.current = null
    }
  }, [store, me, frame])

  const onMount = useCallback(
    (ed: Editor) => {
      editorRef.current = ed
      setEditor(ed)
      if (import.meta.env.DEV) (window as unknown as { editor: Editor }).editor = ed

      if (initialView) applyView(ed, initialView)
      if (syncRef.current?.isReady) frame(ed)
      mirrorViewToHash(ed)

      if (!me) {
        // Quickdraw's own read-only mode also blocks panning, so viewers get
        // the hand tool instead, pinned: the guards on the wrapper below stop
        // the keyboard, paste, drop and context menu from reaching the board.
        ed.setTool('hand')
        ed.on('tool', () => {
          if (ed.tool !== 'hand') ed.setTool('hand')
        })
        return
      }

      ed.on('scribbles', () => syncRef.current?.sendLaser(ed.getScribbles()))
    },
    [me, initialView, frame]
  )

  // Cursor positions are read off the wrapper (bubbled from the board), so
  // they always go through the live editor and nothing leaks on remount.
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const ed = editorRef.current
    if (!ed || !me) return
    const r = ed.container.getBoundingClientRect()
    syncRef.current?.sendCursor(ed.screenToPage(e.clientX - r.left, e.clientY - r.top))
  }
  const onPointerLeave = () => syncRef.current?.sendCursor(null)

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation()
  const guards = me
    ? {}
    : {
        onKeyDownCapture: (e: KeyboardEvent<HTMLDivElement>) => {
          const meta = e.metaKey || e.ctrlKey
          const zoom = (meta && ['=', '+', '-'].includes(e.key)) || (e.shiftKey && ['1', '!', '0', ')'].includes(e.key))
          if (!zoom) e.stopPropagation()
        },
        onPasteCapture: stop,
        onDropCapture: stop,
        onDragOverCapture: stop,
        onContextMenuCapture: stop,
      }

  return (
    <div className="CanvasRoot" data-theme={theme} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} {...guards}>
      <Quickdraw
        store={store}
        theme={theme}
        grid={grid}
        hideUi={!me}
        onMount={onMount}
        onThemeChange={(t) => {
          setTheme(t)
          writePref('iwir:theme', t)
        }}
        onGridChange={(g) => {
          setGrid(g)
          writePref('iwir:grid', g)
        }}
      />
      {editor && <Cursors editor={editor} peers={peers} people={people} />}
      {editor && <AttributionOverlay editor={editor} people={people} meId={me?.id ?? null} />}
      <TopBar me={me} onMeChange={onMeChange} onSignOut={onSignOut} editor={editor} status={status} peers={peers} people={people} />
    </div>
  )
}
