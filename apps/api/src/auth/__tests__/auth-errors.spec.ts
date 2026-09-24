import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@app/shared';
import { toAuthErrorBody } from '../auth-errors.js';

const betterAuthError = (statusCode: number, code: string, message = `${code} message`) => ({
  statusCode,
  body: { code, message },
});

describe('toAuthErrorBody', () => {
  it.each([
    ['INVALID_EMAIL_OR_PASSWORD', 401, 'AUTH_INVALID_CREDENTIALS'],
    ['EMAIL_NOT_VERIFIED', 403, 'AUTH_EMAIL_NOT_VERIFIED'],
    ['INVALID_TOKEN', 400, 'AUTH_INVALID_TOKEN'],
    ['TOKEN_EXPIRED', 401, 'AUTH_INVALID_TOKEN'],
  ])('maps %s to %s', (code, status, expected) => {
    expect(toAuthErrorBody(betterAuthError(status, code), '/sign-in/email')).toEqual({
      code: expected,
      message: `${code} message`,
      params: {},
    });
  });

  it('attributes a short password to `password` on sign-up', () => {
    expect(toAuthErrorBody(betterAuthError(400, 'PASSWORD_TOO_SHORT'), '/sign-up/email')).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      params: {},
      fields: {
        password: [
          {
            code: 'MIN_LENGTH',
            message: 'PASSWORD_TOO_SHORT message',
            params: { min: PASSWORD_MIN_LENGTH },
          },
        ],
      },
    });
  });

  it('attributes a long password to `newPassword` on reset', () => {
    const body = toAuthErrorBody(betterAuthError(400, 'PASSWORD_TOO_LONG'), '/reset-password');

    expect(body.fields).toEqual({
      newPassword: [
        {
          code: 'MAX_LENGTH',
          message: 'PASSWORD_TOO_LONG message',
          params: { max: PASSWORD_MAX_LENGTH },
        },
      ],
    });
  });

  it('attributes an invalid email to `email` with the Zod format param', () => {
    const body = toAuthErrorBody(betterAuthError(400, 'INVALID_EMAIL'), '/sign-up/email');

    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fields).toEqual({
      email: [
        { code: 'INVALID_FORMAT', message: 'INVALID_EMAIL message', params: { format: 'email' } },
      ],
    });
  });

  it('reads field paths back out of a schema validation message', () => {
    const body = toAuthErrorBody(
      betterAuthError(
        400,
        'VALIDATION_ERROR',
        '[body.email] Invalid email address; [body.address.city] Required; [body] Expected object',
      ),
      '/sign-up/email',
    );

    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fields).toEqual({
      email: [{ code: 'INVALID_INPUT', message: 'Invalid email address', params: {} }],
      'address.city': [{ code: 'INVALID_INPUT', message: 'Required', params: {} }],
      _root: [{ code: 'INVALID_INPUT', message: 'Expected object', params: {} }],
    });
  });

  it('keeps an unparseable validation message on the body as a whole', () => {
    const body = toAuthErrorBody(betterAuthError(400, 'VALIDATION_ERROR'), '/sign-up/email');

    expect(body.fields).toEqual({
      _root: [{ code: 'INVALID_INPUT', message: 'VALIDATION_ERROR message', params: {} }],
    });
  });

  it('treats any other 401 as unauthenticated', () => {
    expect(toAuthErrorBody(betterAuthError(401, 'SESSION_EXPIRED'), '/update-user').code).toBe(
      'AUTH_UNAUTHENTICATED',
    );
  });

  it('falls back to HTTP_<status> for anything unrecognized', () => {
    expect(
      toAuthErrorBody(betterAuthError(422, 'SOMETHING_NEW', 'Something new'), '/sign-up/email'),
    ).toEqual({ code: 'HTTP_422', message: 'Something new', params: {} });
  });

  it('survives a body with no code or message', () => {
    expect(toAuthErrorBody({ statusCode: 500 }, '/sign-in/email')).toEqual({
      code: 'HTTP_500',
      message: 'Request failed with status 500',
      params: {},
    });
  });
});
