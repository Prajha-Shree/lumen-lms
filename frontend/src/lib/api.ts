import type { Session } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'ERROR',
    public readonly body?: unknown,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: Record<string, string[]> } };

// The access token lives only in memory (never localStorage), so an XSS payload
// can't read a long-lived credential. The refresh token is an httpOnly cookie.
let accessToken: string | null = null;
let onSessionEnded: (() => void) | null = null;
let refreshing: Promise<Session | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function setOnSessionEnded(cb: () => void) {
  onSessionEnded = cb;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(path, { ...init, headers, credentials: 'include' });
}

async function toError(res: Response): Promise<ApiError> {
  const body: unknown = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => undefined) : undefined;
  const err = (body as ErrorBody | undefined)?.error;
  return new ApiError(res.status, err?.message ?? (res.status >= 500 ? 'The server had a problem. Please try again.' : res.statusText), err?.code, body, err?.details);
}

/** Exchanges the refresh cookie for a new session. Concurrent callers share one request. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return null;
      const session = (await res.json()) as Session;
      accessToken = session.accessToken;
      return session;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * JSON fetch against the backend. On an expired access token it refreshes once and
 * retries transparently; if refresh fails the session-ended handler signs the user out.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await request(path, init);
  if (res.status === 401 && accessToken && !path.startsWith('/api/auth/')) {
    const session = await refreshSession();
    if (session) {
      res = await request(path, init);
    } else {
      accessToken = null;
      onSessionEnded?.();
    }
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const http = {
  get: <T>(path: string) => api<T>(path),
  post: <T>(path: string, body?: unknown, init?: RequestInit) =>
    api<T>(path, { ...init, method: 'POST', body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => api<T>(path, { method: 'DELETE' }),
};

/** Fetches a protected binary (e.g. an attachment) and triggers a download. */
export async function downloadFile(path: string, fileName: string) {
  let res = await request(path);
  if (res.status === 401 && (await refreshSession())) res = await request(path);
  if (!res.ok) throw await toError(res);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
