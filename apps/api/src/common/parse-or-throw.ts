import type { z } from 'zod';
import { CodedValidationException } from './errors/coded-exceptions';
import { zodIssuesToFields } from './errors/validation-fields';

/**
 * Parses with a shared schema and fails exactly as ZodValidationPipe would.
 * For services whose rules must hold for callers that skip the controller.
 */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new CodedValidationException(zodIssuesToFields(result.error.issues));
  return result.data;
}
