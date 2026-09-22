import { z } from 'zod';
import type { ErrorCode, WireErrorCode } from './codes.js';

/** Interpolation values for a code's message — `{ min: 12 }` for MIN_LENGTH. */
export type ErrorParams = Record<string, string | number | boolean>;

/**
 * Key used in the `fields` map for an issue that belongs to the body as a
 * whole rather than to one property (an empty Zod path).
 */
export const ROOT_FIELD = '_root';

export interface FieldError {
  code: ErrorCode;
  /** English fallback for logs and non-web consumers; the SPA never renders it. */
  message: string;
  params: ErrorParams;
}

export interface ErrorBody {
  code: WireErrorCode;
  /** English fallback for logs and non-web consumers; the SPA never renders it. */
  message: string;
  params: ErrorParams;
  /** Present on VALIDATION_FAILED only, keyed by dotted field path. */
  fields?: Record<string, FieldError[]>;
}

/** Every error response from the API, whatever threw it. */
export interface ErrorResponseBody {
  error: ErrorBody;
}

const errorParamsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

/**
 * Codes are parsed as plain strings rather than against the enum on purpose.
 * A client deployed behind the API would otherwise reject the whole envelope
 * over one unrecognized code and lose `fields` and the status along with it.
 */
export const parsedFieldErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  params: errorParamsSchema.default({}),
});
export type ParsedFieldError = z.infer<typeof parsedFieldErrorSchema>;

/** Used by the SPA to parse an untrusted response body instead of casting it. */
export const errorResponseBodySchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    params: errorParamsSchema.default({}),
    fields: z.record(z.string(), z.array(parsedFieldErrorSchema)).optional(),
  }),
});
export type ParsedErrorResponseBody = z.infer<typeof errorResponseBodySchema>;
