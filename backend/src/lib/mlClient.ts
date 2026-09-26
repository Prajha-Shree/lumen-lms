import type { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import { logger } from './logger.js';

/**
 * Calls the ml-service with the shared internal token. Responses are validated with
 * zod so a contract drift between services fails loudly here, not in the UI.
 */
export async function mlPost<S extends z.ZodType>(
  path: string,
  body: unknown,
  schema: S,
  opts: { timeoutMs?: number; unavailableMessage?: string } = {},
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(new URL(path, env.ML_SERVICE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
  } catch (err) {
    logger.warn({ err, path }, 'ml-service unreachable');
    throw new HttpError(503, opts.unavailableMessage ?? 'The AI service is temporarily unavailable. Please try again shortly.', 'ML_UNAVAILABLE');
  }
  if (res.status === 422 || res.status === 400) {
    const detail = ((await res.json().catch(() => ({}))) as { detail?: unknown }).detail;
    throw new HttpError(400, typeof detail === 'string' ? detail : 'Invalid request to the AI service', 'ML_REJECTED');
  }
  if (!res.ok) {
    logger.error({ status: res.status, path }, 'ml-service error');
    throw new HttpError(502, opts.unavailableMessage ?? 'The AI service returned an error.', 'ML_ERROR');
  }
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues, path }, 'ml-service contract mismatch');
    throw new HttpError(502, 'The AI service returned an unexpected response.', 'ML_CONTRACT');
  }
  return parsed.data;
}

/** Posts raw bytes (e.g. a JPEG frame) instead of JSON. */
export async function mlPostBinary<S extends z.ZodType>(path: string, bytes: Buffer, contentType: string, schema: S, timeoutMs = 5000): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(new URL(path, env.ML_SERVICE_URL), {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new HttpError(503, 'Proctoring analysis is temporarily unavailable.', 'ML_UNAVAILABLE');
  }
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { detail?: unknown }).detail;
    throw new HttpError(res.status === 422 || res.status === 400 || res.status === 413 ? 400 : 502, typeof detail === 'string' ? detail : 'Frame analysis failed', 'ML_ERROR');
  }
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new HttpError(502, 'The AI service returned an unexpected response.', 'ML_CONTRACT');
  return parsed.data;
}
