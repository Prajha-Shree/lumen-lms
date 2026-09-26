import { z } from 'zod';
import { HttpError } from '../middleware/error.js';

/** Parses untrusted input or throws a 400 with per-field messages. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION', z.flattenError(result.error).fieldErrors);
  }
  return result.data;
}

export const uuidParam = z.object({ id: z.uuid() });
export const idParam = (params: unknown) => parse(uuidParam, params).id;
