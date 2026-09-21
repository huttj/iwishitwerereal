import type { SessionInfo } from './AuthDurableObject'

export const SESSION_COOKIE = 'iwir_session'
const SESSION_MAX_AGE_S = 60 * 24 * 60 * 60

export function authStub(env: Env) {
  return env.AUTH.get(env.AUTH.idFromName('main'))
}

export function isAdminEmail(env: Env, email: string) {
  return env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase())
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function sessionCookie(value: string, request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure}`
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export async function getSession(request: Request, env: Env): Promise<SessionInfo | null> {
  const sessionId = readCookie(request, SESSION_COOKIE)
  if (!sessionId) return null
  return authStub(env).getSession(sessionId)
}

/** The public origin used in emailed links. Local dev uses the request origin. */
export function publicOrigin(request: Request, env: Env) {
  const origin = new URL(request.url).origin
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
  return env.SITE_URL
}
