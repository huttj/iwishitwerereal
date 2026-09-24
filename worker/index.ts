import { AutoRouter, error, IRequest, json, RequestHandler } from 'itty-router'
import { getAssetObjectName, handleAssetDownload, handleAssetUpload } from './assetUploads'
import { authStub, clearSessionCookie, getSession, isAdminEmail, publicOrigin, readCookie, SESSION_COOKIE, sessionCookie } from './auth'
import { READONLY_HEADER, USER_HEADER } from './BoardDurableObject'
import { sendMagicLink } from './email'
import type { Me, Person } from '../shared/types'

export { AuthDurableObject } from './AuthDurableObject'
export { BoardDurableObject } from './BoardDurableObject'
export { TldrawDurableObject } from './LegacyTldrawDurableObject'

type Args = [env: Env, ctx: ExecutionContext]
type AuthedRequest = IRequest & { session: NonNullable<Awaited<ReturnType<typeof getSession>>> }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AVATAR_MAX_BYTES = 512 * 1024
const ROOM_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

async function readJson<T>(request: IRequest): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>
  } catch {
    return {}
  }
}

/** Middleware: attach the session or bail with 401. */
const requireAuth: RequestHandler<IRequest, Args> = async (request, env) => {
  const session = await getSession(request, env)
  if (!session) return error(401, 'Sign in required')
  ;(request as AuthedRequest).session = session
}

const requireAdmin: RequestHandler<IRequest, Args> = async (request, env, ctx) => {
  const denied = await requireAuth(request, env, ctx)
  if (denied) return denied
  if (!isAdminEmail(env, (request as AuthedRequest).session.email)) return error(403, 'Admins only')
}

function toMe(env: Env, session: AuthedRequest['session']): Me {
  return {
    id: session.id,
    email: session.email,
    name: session.name,
    avatar: session.avatar,
    isAdmin: isAdminEmail(env, session.email),
  }
}

const router = AutoRouter<IRequest, Args>({
  catch: (e) => {
    console.error(e)
    return error(e)
  },
})
  // ---- auth ----
  .post('/api/auth/request', async (request, env) => {
    const body = await readJson<{ email: string }>(request)
    const email = (body.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return error(400, 'That does not look like an email address')

    const auth = authStub(env)
    if (!(await auth.isAllowed(email))) {
      return error(403, 'This canvas is invite-only. Ask Joshua to add your email.')
    }
    const result = await auth.createLoginToken(email)
    if ('retryInMs' in result) {
      return error(429, `A link was just sent. Try again in ${Math.ceil(result.retryInMs / 1000)}s.`)
    }
    const link = `${publicOrigin(request, env)}/api/auth/verify?token=${encodeURIComponent(result.token)}`
    if (publicOrigin(request, env) !== env.SITE_URL) console.log(`[dev] magic link for ${email}: ${link}`)
    try {
      await sendMagicLink(env, email, link)
    } catch (e) {
      console.error('email send failed', e)
      return error(502, 'Could not send the email. Try again in a minute.')
    }
    return json({ ok: true })
  })

  .get('/api/auth/verify', async (request, env) => {
    const token = typeof request.query.token === 'string' ? request.query.token : ''
    const origin = publicOrigin(request, env)
    if (!token) return Response.redirect(`${origin}/?login=invalid`, 302)
    const result = await authStub(env).redeemLoginToken(token)
    if (!result) return Response.redirect(`${origin}/?login=invalid`, 302)
    return new Response(null, {
      status: 302,
      headers: { location: `${origin}/`, 'set-cookie': sessionCookie(result.sessionId, request) },
    })
  })

  .post('/api/auth/logout', async (request, env) => {
    const sessionId = readCookie(request, SESSION_COOKIE)
    if (sessionId) await authStub(env).deleteSession(sessionId)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json', 'set-cookie': clearSessionCookie(request) },
    })
  })

  // ---- me ----
  .get('/api/me', requireAuth, (request, env) => json(toMe(env, (request as AuthedRequest).session)))

  .post('/api/me', requireAuth, async (request, env) => {
    const session = (request as AuthedRequest).session
    const body = await readJson<{ name: string }>(request)
    const name = (body.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
    if (name.length < 1) return error(400, 'Name is required')
    await authStub(env).setName(session.email, name)
    return json(toMe(env, { ...session, name }))
  })

  // The photo is stored under the same R2 prefix as pasted images (immutable,
  // cached forever), so a new photo is a new URL and nothing stale is served.
  .post('/api/me/avatar', requireAuth, async (request, env) => {
    const session = (request as AuthedRequest).session
    const contentType = request.headers.get('content-type') ?? ''
    if (!/^image\/(png|jpeg|webp)$/.test(contentType)) return error(400, 'Send a PNG, JPEG or WebP image')
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength === 0) return error(400, 'Empty image')
    if (bytes.byteLength > AVATAR_MAX_BYTES) return error(413, 'That photo is too large')
    const uploadId = `avatar-${session.id}-${Date.now().toString(36)}`
    await env.UPLOADS.put(getAssetObjectName(uploadId), bytes, { httpMetadata: { contentType } })
    const avatar = `/api/uploads/${uploadId}`
    await authStub(env).setAvatar(session.email, avatar)
    return json(toMe(env, { ...session, avatar }))
  })

  .delete('/api/me/avatar', requireAuth, async (request, env) => {
    const session = (request as AuthedRequest).session
    await authStub(env).setAvatar(session.email, null)
    return json(toMe(env, { ...session, avatar: null }))
  })

  // ---- people ----
  // Names and photos only, no emails: viewers see them on cursors and attribution labels anyway.
  .get('/api/people', async (_request, env) => {
    const people: Person[] = (await authStub(env).listUsers()).map((u) => ({ id: u.id, name: u.name, avatar: u.avatar }))
    return json(people)
  })

  // ---- admin ----
  .get('/api/admin/users', requireAdmin, async (_request, env) => json(await authStub(env).listUsers()))

  /** The old tldraw room's raw records, as a backup. Its content was imported onto the board on 2026-09-24. */
  .get('/api/admin/legacy/tldraw', requireAdmin, async (_request, env) => {
    const legacy = env.TLDRAW_DURABLE_OBJECT.get(env.TLDRAW_DURABLE_OBJECT.idFromName('main'))
    return json(await legacy.records())
  })

  .post('/api/admin/users', requireAdmin, async (request, env) => {
    const body = await readJson<{ email: string }>(request)
    const email = (body.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return error(400, 'That does not look like an email address')
    const user = await authStub(env).addUser(email, (request as AuthedRequest).session.email)
    return json(user, { status: 201 })
  })

  .delete('/api/admin/users/:email', requireAdmin, async (request, env) => {
    const email = decodeURIComponent(request.params.email).toLowerCase()
    const removed = await authStub(env).removeUser(email)
    if (!removed) return error(404, 'Not found, or that user is an admin')
    return json({ ok: true })
  })

  // ---- canvas sync (websocket) ----
  // Anyone can connect and watch. Only signed-in people get a writable session;
  // the room enforces that server-side, so a modified client cannot edit either.
  .get('/api/connect/:roomId', async (request, env) => {
    const roomId = request.params.roomId
    if (!ROOM_RE.test(roomId)) return error(400, 'Bad room id')
    const session = await getSession(request, env)
    const headers = new Headers(request.headers)
    headers.set(READONLY_HEADER, session ? '0' : '1')
    if (session) headers.set(USER_HEADER, session.id)
    else headers.delete(USER_HEADER)
    const room = env.BOARD.get(env.BOARD.idFromName(roomId))
    return room.fetch(request.url, { headers, body: request.body })
  })

  // ---- assets ----
  .post('/api/uploads/:uploadId', requireAuth, handleAssetUpload)
  .get('/api/uploads/:uploadId', handleAssetDownload)

  .all('/api/*', () => error(404, 'Not found'))

export default {
  fetch: router.fetch,
} satisfies ExportedHandler<Env>
