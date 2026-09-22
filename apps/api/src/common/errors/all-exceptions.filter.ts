import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
  type LoggerService,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ErrorBody, ErrorResponseBody } from '@app/shared';
import { isCodedErrorBody } from './coded-exceptions.js';

/**
 * The only place a thrown error becomes a response body, so every error the
 * API returns has the same shape:
 *
 *   1. a Coded*Exception already carries {code, message, params};
 *   2. any other HttpException — Nest's own 404 for an unmatched route, say —
 *      gets a synthesized HTTP_<status>, so paths nobody retrofitted still fit
 *      the envelope;
 *   3. anything else is a bug: logged in full server-side, returned as a bare
 *      INTERNAL_SERVER_ERROR. The real message and stack never reach a client.
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
    this.logger.error(error.message, error.stack, AllExceptionsFilter.name);

    return { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error', params: {} };
  }
}
