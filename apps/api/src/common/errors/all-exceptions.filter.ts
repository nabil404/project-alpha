import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
  type LoggerService,
} from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import type { Response } from 'express';
import type { ErrorBody, ErrorResponseBody } from '@app/shared';
import { isCodedErrorBody } from './coded-exceptions';

/**
 * The only place a thrown error becomes a response body, so every error the
 * API returns has the same shape:
 *
 *   1. a Coded*Exception already carries {code, message, params};
 *   2. any other HttpException — Nest's own 404 for an unmatched route, say —
 *      gets a synthesized HTTP_<status>, so paths nobody retrofitted still fit
 *      the envelope;
 *   3. anything else is a bug: logged server-side, returned as a bare
 *      INTERNAL_SERVER_ERROR. The real message and stack never reach a client.
 *      A database error is logged by SQLSTATE and constraint only: Drizzle's
 *      message carries the query's parameters, which can be message text.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ErrorResponseBody = { error: this.toBody(exception, status) };
    response.status(status).json(body);
  }

  private toBody(exception: unknown, status: number): ErrorBody {
    if (exception instanceof HttpException) {
      const thrown = exception.getResponse();

      return isCodedErrorBody(thrown)
        ? thrown
        : { code: `HTTP_${status}`, message: exception.message, params: {} };
    }

    const error = exception instanceof Error ? exception : new Error(String(exception));
    const queryError = findQueryError(error);
    if (queryError) {
      this.logger.error(
        describeQueryError(error, queryError),
        framesOf(queryError),
        AllExceptionsFilter.name,
      );
    } else {
      this.logger.error(error.message, error.stack, AllExceptionsFilter.name);
    }

    return { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error', params: {} };
  }
}

interface ErrorChainLink {
  query?: unknown;
  params?: unknown;
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/** A Drizzle query error in the cause chain: by class, or by its `query` + `params` shape. */
function findQueryError(error: Error): ErrorChainLink | null {
  let current: unknown = error;
  for (let hop = 0; hop < 5 && typeof current === 'object' && current !== null; hop++) {
    const link = current as ErrorChainLink;
    if (
      current instanceof DrizzleQueryError ||
      (typeof link.query === 'string' && Array.isArray(link.params))
    ) {
      return link;
    }
    current = link.cause;
  }
  return null;
}

/** The stack without its first line, which repeats the message; nothing if the two cannot be told apart. */
function framesOf(link: ErrorChainLink): string | undefined {
  if (!(link instanceof Error) || !link.stack || !link.message) return undefined;
  const end = link.stack.indexOf(link.message);
  return end === -1 ? undefined : link.stack.slice(end + link.message.length).replace(/^\n/, '');
}

/**
 * Names only: every message in the chain may quote the query or its
 * parameters, and so does each stack's first line.
 */
function describeQueryError(error: Error, queryError: ErrorChainLink): string {
  let code: string | undefined;
  let constraint: string | undefined;
  let current: unknown = queryError.cause;
  for (let hop = 0; hop < 5 && typeof current === 'object' && current !== null; hop++) {
    const link = current as ErrorChainLink;
    if (code === undefined && typeof link.code === 'string') code = link.code;
    if (constraint === undefined && typeof link.constraint === 'string') {
      constraint = link.constraint;
    }
    current = link.cause;
  }
  const wrapper = error === queryError ? '' : ` (wrapped in ${error.name})`;
  return (
    `DrizzleQueryError${wrapper}: SQLSTATE ${code ?? 'unknown'}` +
    (constraint ? `, constraint ${constraint}` : '')
  );
}
