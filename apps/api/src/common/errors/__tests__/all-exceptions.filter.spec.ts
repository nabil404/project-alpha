import {
  HttpException,
  HttpStatus,
  NotFoundException,
  type ArgumentsHost,
  type LoggerService,
} from '@nestjs/common';
import type { ErrorResponseBody } from '@app/shared';
import { AllExceptionsFilter } from '../all-exceptions.filter.js';
import { CodedUnauthorizedException, CodedValidationException } from '../coded-exceptions.js';

function capture() {
  const sent: { status?: number; body?: ErrorResponseBody } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: ErrorResponseBody) {
      sent.body = body;
    },
  };

  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { sent, host };
}

const logged: unknown[][] = [];
const logger = {
  error: (...args: unknown[]) => {
    logged.push(args);
  },
} as unknown as LoggerService;

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter(logger);

  it('passes a coded exception through with its code and params', () => {
    const { sent, host } = capture();

    filter.catch(
      new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password'),
      host,
    );

    expect(sent.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(sent.body).toEqual({
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        params: {},
      },
    });
  });

  it('keeps the fields map on a validation failure', () => {
    const { sent, host } = capture();
    const fields = {
      password: [{ code: 'MIN_LENGTH' as const, message: 'too short', params: { min: 12 } }],
    };

    filter.catch(new CodedValidationException(fields), host);

    expect(sent.body?.error.code).toBe('VALIDATION_FAILED');
    expect(sent.body?.error.fields).toEqual(fields);
  });

  it('synthesizes HTTP_<status> for a framework exception that carries no code', () => {
    const { sent, host } = capture();

    filter.catch(new NotFoundException('Cannot GET /api/nope'), host);

    expect(sent.status).toBe(HttpStatus.NOT_FOUND);
    expect(sent.body?.error.code).toBe('HTTP_404');
  });

  it('still wraps an HttpException whose body is an uncoded object', () => {
    const { sent, host } = capture();

    filter.catch(new HttpException({ whatever: true }, HttpStatus.I_AM_A_TEAPOT), host);

    expect(sent.status).toBe(HttpStatus.I_AM_A_TEAPOT);
    expect(sent.body?.error.code).toBe('HTTP_418');
  });

  it('never leaks the message or stack of an unexpected error to the client', () => {
    const { sent, host } = capture();
    const bug = new Error('connection string postgres://app:hunter2@db/app');

    filter.catch(bug, host);

    expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(sent.body).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error', params: {} },
    });
    expect(JSON.stringify(sent.body)).not.toContain('hunter2');
    // The detail is not lost — it goes to the server log instead.
    expect(logged.at(-1)?.[0]).toBe(bug.message);
  });

  it('handles a thrown non-Error without crashing the filter', () => {
    const { sent, host } = capture();

    filter.catch('just a string', host);

    expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(sent.body?.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
