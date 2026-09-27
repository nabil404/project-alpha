import { validateEnv } from '../env.schema';

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
  STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  STORAGE_BUCKET: 'project-alpha-dev',
  STORAGE_ACCESS_KEY_ID: 'key-id',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
  STORAGE_PUBLIC_BASE_URL: 'https://pub-example.r2.dev',
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

  it('defaults the storage region to auto', () => {
    expect(validateEnv(base).STORAGE_REGION).toBe('auto');
  });

  it('refuses to start without the storage bucket', () => {
    const { STORAGE_BUCKET: _omitted, ...withoutBucket } = base;
    expect(() => validateEnv(withoutBucket)).toThrow(/STORAGE_BUCKET/);
  });

  it('rejects a public base URL that is not a URL', () => {
    expect(() => validateEnv({ ...base, STORAGE_PUBLIC_BASE_URL: 'media' })).toThrow(
      /STORAGE_PUBLIC_BASE_URL/,
    );
  });
});
