import type { z, ZodTypeAny } from 'zod';
import { badRequest } from './errors.js';

/** zod safeParse → value, or a 400 `bad_request` listing every issue. */
export function parse<T extends ZodTypeAny>(schema: T, input: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || what}: ${i.message}`).join('; ');
    throw badRequest('bad_request', `Invalid ${what}: ${detail}`);
  }
  return result.data;
}
