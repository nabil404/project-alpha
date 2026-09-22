import type { ErrorParams, ParsedFieldError } from '@app/shared';

/**
 * A failed API call, carrying the coded envelope the API sends. Read `code`
 * and resolve it through the message catalog; never render `message`, which is
 * the API's English fallback for logs.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params: ErrorParams;
  readonly fields: Record<string, ParsedFieldError[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    params: ErrorParams = {},
    fields: Record<string, ParsedFieldError[]> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.params = params;
    this.fields = fields;
  }

  /** The rule failures for one form control, if the API attributed any. */
  fieldErrors(name: string): ParsedFieldError[] {
    return this.fields[name] ?? [];
  }
}
