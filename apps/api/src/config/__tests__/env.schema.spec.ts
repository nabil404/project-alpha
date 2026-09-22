import { validateEnv } from '../env.schema.js';

const base = {
  APP_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  META_APP_SECRET: 'secret',
  META_VERIFY_TOKEN: 'token',
  META_GRAPH_VERSION: 'v21.0',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  SMTP_URL: 'smtp://user:pass@smtp.example.com:587',
  MAIL_FROM: 'Orders <orders@example.com>',
};

describe('validateEnv', () => {
  it('accepts a complete environment and applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('treats an unset optional variable as absent, not as an empty string', () => {
    const env = validateEnv({ ...base, SENTRY_DSN: '', GOOGLE_CLIENT_ID: '' });
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() => validateEnv({ ...base, TOKEN_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    );
  });

  it('rejects a missing secret instead of starting', () => {
    const { META_APP_SECRET: _omitted, ...withoutSecret } = base;
    expect(() => validateEnv(withoutSecret)).toThrow(/META_APP_SECRET/);
  });
});
