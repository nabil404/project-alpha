import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isErrorCode, type ErrorCode, type ErrorParams, type FieldError } from '@app/shared';

/**
 * The body a Coded*Exception hands to Nest. AllExceptionsFilter recognizes it
 * and wraps it as `{ error: ... }`; any other HttpException falls back to a
 * synthesized HTTP_<status>.
 */
export interface CodedErrorBody {
  code: ErrorCode;
  message: string;
  params: ErrorParams;
  fields?: Record<string, FieldError[]>;
}

export function isCodedErrorBody(body: unknown): body is CodedErrorBody {
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const candidate = body as Partial<CodedErrorBody>;
  return (
    typeof candidate.code === 'string' &&
    isErrorCode(candidate.code) &&
    typeof candidate.message === 'string'
  );
}

/**
 * Throw one of these instead of the bare NestJS exception, so the response
 * carries a code the SPA can translate rather than an English sentence it
 * would have to parse.
 *
 *   throw new CodedUnauthorizedException(
 *     'AUTH_INVALID_CREDENTIALS',
 *     'Invalid email or password',
 *   );
 */
export class CodedBadRequestException extends BadRequestException {
  constructor(code: ErrorCode, message: string, params: ErrorParams = {}) {
    super({ code, message, params } satisfies CodedErrorBody);
  }
}

export class CodedUnauthorizedException extends UnauthorizedException {
  constructor(code: ErrorCode, message: string, params: ErrorParams = {}) {
    super({ code, message, params } satisfies CodedErrorBody);
  }
}

export class CodedForbiddenException extends ForbiddenException {
  constructor(code: ErrorCode, message: string, params: ErrorParams = {}) {
    super({ code, message, params } satisfies CodedErrorBody);
  }
}

export class CodedNotFoundException extends NotFoundException {
  constructor(code: ErrorCode, message: string, params: ErrorParams = {}) {
    super({ code, message, params } satisfies CodedErrorBody);
  }
}

export class CodedConflictException extends ConflictException {
  constructor(code: ErrorCode, message: string, params: ErrorParams = {}) {
    super({ code, message, params } satisfies CodedErrorBody);
  }
}

/** Carries the per-field breakdown that plain Coded*Exceptions don't have. */
export class CodedValidationException extends BadRequestException {
  constructor(fields: Record<string, FieldError[]>) {
    super({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      params: {},
      fields,
    } satisfies CodedErrorBody);
  }
}
