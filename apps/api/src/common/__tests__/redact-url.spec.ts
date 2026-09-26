import { redactUrl } from '../redact-url.js';

describe('redactUrl', () => {
  it('masks the email verification token', () => {
    expect(redactUrl('/api/v1/auth/verify-email?token=eyJhbGciOi.abc.def&callbackURL=%2F')).toBe(
      '/api/v1/auth/verify-email?token=[REDACTED]&callbackURL=%2F',
    );
  });

  it('masks the reset token in the path', () => {
    expect(redactUrl('/api/v1/auth/reset-password/Xk29sQ01abc?callbackURL=%2Freset-password')).toBe(
      '/api/v1/auth/reset-password/[REDACTED]?callbackURL=%2Freset-password',
    );
  });

  it('masks an OAuth code and state', () => {
    expect(redactUrl('/api/v1/auth/callback/google?state=s1&code=c2&scope=email')).toBe(
      '/api/v1/auth/callback/google?state=[REDACTED]&code=[REDACTED]&scope=email',
    );
  });

  it("masks Meta's webhook verify token", () => {
    expect(
      redactUrl(
        '/api/v1/webhooks/messenger?hub.mode=subscribe&hub.verify_token=s3cret&hub.challenge=42',
      ),
    ).toBe(
      '/api/v1/webhooks/messenger?hub.mode=subscribe&hub.verify_token=[REDACTED]&hub.challenge=42',
    );
  });

  it('matches a percent-encoded key', () => {
    expect(redactUrl('/x?%74oken=abc')).toBe('/x?%74oken=[REDACTED]');
  });

  it('leaves URLs without credentials alone', () => {
    expect(redactUrl('/api/v1/orders?page=2&status=new')).toBe('/api/v1/orders?page=2&status=new');
    expect(redactUrl('/health')).toBe('/health');
    expect(redactUrl('/api/v1/auth/reset-password')).toBe('/api/v1/auth/reset-password');
  });
});
