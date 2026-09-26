import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, getAccessToken, setAccessToken, setOnSessionEnded } from './api';

type Call = { url: string; auth: string | null };

/** Minimal fetch fake: `/api/auth/refresh` answers from `refreshReply`, others from `handler`. */
function fakeFetch(handler: (c: Call) => Response, refreshReply: () => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const c = { url, auth: new Headers(init?.headers).get('Authorization') };
      calls.push(c);
      return url === '/api/auth/refresh' ? refreshReply() : handler(c);
    }),
  );
  return calls;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = (token: string) => json(200, { accessToken: token, user: { id: 'u' }, tenant: { id: 't' } });

describe('api client', () => {
  beforeEach(() => setAccessToken('old-token'));
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('sends the in-memory access token as a Bearer header', async () => {
    const calls = fakeFetch(() => json(200, { ok: true }), () => session('x'));
    await api('/api/things');
    expect(calls[0]!.auth).toBe('Bearer old-token');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const calls = fakeFetch(
      (c) => (c.auth === 'Bearer new-token' ? json(200, { ok: 1 }) : json(401, { error: { code: 'TOKEN_INVALID' } })),
      () => session('new-token'),
    );
    await expect(api('/api/things')).resolves.toEqual({ ok: 1 });
    expect(calls.map((c) => c.url)).toEqual(['/api/things', '/api/auth/refresh', '/api/things']);
    expect(getAccessToken()).toBe('new-token');
  });

  it('concurrent 401s share a single refresh request', async () => {
    const calls = fakeFetch(
      (c) => (c.auth === 'Bearer new-token' ? json(200, {}) : json(401, {})),
      () => session('new-token'),
    );
    await Promise.all([api('/api/a'), api('/api/b'), api('/api/c')]);
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('ends the session when refresh fails', async () => {
    const ended = vi.fn();
    setOnSessionEnded(ended);
    fakeFetch(() => json(401, { error: { code: 'TOKEN_INVALID', message: 'expired' } }), () => json(401, {}));
    await expect(api('/api/things')).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBeNull();
  });

  it('never tries to refresh for auth endpoints themselves', async () => {
    const calls = fakeFetch(() => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'nope' } }), () => session('x'));
    await expect(api('/api/auth/login', { method: 'POST' })).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(calls).toHaveLength(1);
  });

  it('surfaces per-field validation errors from the server', async () => {
    fakeFetch(() => json(400, { error: { code: 'VALIDATION', message: 'Validation failed', details: { email: ['Already in use'] } } }), () => session('x'));
    const err = await api('/api/users', { method: 'POST' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fieldErrors).toEqual({ email: ['Already in use'] });
  });
});
