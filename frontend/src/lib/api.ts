export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'ERROR',
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

type ErrorBody = { error?: { code?: string; message?: string } };

/**
 * Thin fetch wrapper for the backend. Paths are relative (`/api/...`) and go through
 * the Vite dev proxy, so the browser only ever talks to its own origin.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'include',
  });
  const body: unknown = res.headers.get('content-type')?.includes('application/json') ? await res.json() : undefined;
  if (!res.ok) {
    const err = (body as ErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.message ?? res.statusText, err?.code, body);
  }
  return body as T;
}
