import type { Me, Person, UserSummary } from '../shared/types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

export const api = {
  me: () => call<Me>('/api/me'),
  setName: (name: string) => call<Me>('/api/me', { method: 'POST', body: JSON.stringify({ name }) }),
  requestLink: (email: string) =>
    call<{ ok: true }>('/api/auth/request', { method: 'POST', body: JSON.stringify({ email }) }),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  setAvatar: (image: Blob) =>
    call<Me>('/api/me/avatar', { method: 'POST', body: image, headers: { 'content-type': image.type } }),
  clearAvatar: () => call<Me>('/api/me/avatar', { method: 'DELETE' }),
  people: () => call<Person[]>('/api/people'),
  admin: {
    list: () => call<UserSummary[]>('/api/admin/users'),
    add: (email: string) =>
      call<UserSummary>('/api/admin/users', { method: 'POST', body: JSON.stringify({ email }) }),
    remove: (email: string) =>
      call<{ ok: true }>(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  },
}
