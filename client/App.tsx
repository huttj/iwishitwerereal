import { useCallback, useEffect, useState } from 'react'
import type { Me } from '../shared/types'
import { Admin } from './Admin'
import { api, ApiError } from './api'
import { Canvas } from './Canvas'
import { Login } from './Login'
import { NamePrompt } from './NamePrompt'

type AuthState = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; me: Me }

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      setAuth({ status: 'signed-in', me })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuth({ status: 'signed-out' })
      else throw e
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    await api.logout()
    setAuth({ status: 'signed-out' })
  }, [])

  const updateMe = useCallback((me: Me) => setAuth({ status: 'signed-in', me }), [])

  const path = window.location.pathname

  if (auth.status === 'loading') return <Splash />

  if (auth.status === 'signed-out') {
    if (path === '/login' || path === '/admin') return <Login />
    // Anyone can look. Editing needs a sign-in.
    return <Canvas key="viewer" me={null} onSignOut={signOut} />
  }

  if (!auth.me.name) return <NamePrompt onDone={(me) => setAuth({ status: 'signed-in', me })} />
  if (path === '/admin') return <Admin me={auth.me} onSignOut={signOut} />
  if (path === '/login') {
    window.location.replace('/')
    return <Splash />
  }
  // Keyed on the user so signing in or out rebuilds the board and its room session.
  return <Canvas key={auth.me.id} me={auth.me} onMeChange={updateMe} onSignOut={signOut} />
}

function Splash() {
  return (
    <div className="Screen">
      <div className="Card Card--quiet">
        <h1 className="Wordmark">i wish it were real</h1>
      </div>
    </div>
  )
}
