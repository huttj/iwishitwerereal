import { handleUnfurlRequest } from 'cloudflare-workers-unfurl'
import { AutoRouter, error, IRequest, json, RequestHandler } from 'itty-router'
import { handleAssetDownload, handleAssetUpload } from './assetUploads'
import { authStub, clearSessionCookie, getSession, isAdminEmail, publicOrigin, readCookie, SESSION_COOKIE, sessionCookie } from './auth'
import { sendMagicLink } from './email'
import { READONLY_HEADER } from './TldrawDurableObject'
import type { Me } from '../shared/types'

export { AuthDurableObject } from './AuthDurableObject'
export { TldrawDurableObject } from './TldrawDurableObject'

type Args = [env: Env, ctx: ExecutionContext]
type AuthedRequest = IRequest & { session: NonNullable<Awaited<ReturnType<typeof getSession>>> }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
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

  // ---- admin ----
  .get('/api/admin/users', requireAdmin, async (_request, env) => json(await authStub(env).listUsers()))

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
    const id = env.TLDRAW_DURABLE_OBJECT.idFromName(roomId)
    const room = env.TLDRAW_DURABLE_OBJECT.get(id)
    return room.fetch(request.url, { headers, body: request.body })
  })

  // ---- assets ----
  .post('/api/uploads/:uploadId', requireAuth, handleAssetUpload)
  .get('/api/uploads/:uploadId', handleAssetDownload)
  .get('/api/unfurl', requireAuth, (request) => handleUnfurlRequest(request))

  .all('/api/*', () => error(404, 'Not found'))

export default {
  fetch: router.fetch,
} satisfies ExportedHandler<Env>
