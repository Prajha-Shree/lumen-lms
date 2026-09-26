import { afterEach, vi } from 'vitest';

type Handler = (path: string, body: unknown) => { status?: number; json: unknown } | 'network-error';

/**
 * Intercepts fetch() calls to the ml-service (supertest uses node http, so API calls
 * under test are unaffected). Returns the list of captured calls for assertions.
 */
export function stubMl(handler: Handler) {
  const calls: { path: string; body: unknown }[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.port !== '8000') return real(input, init);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ path: url.pathname, body });
    const out = handler(url.pathname, body);
    if (out === 'network-error') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});
