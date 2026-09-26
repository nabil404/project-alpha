import { createAuth } from '../../auth/auth.config.js';
import type { Auth } from '../../auth/auth.module.js';

export const STUB_APP_URL = 'http://localhost:5173';

/**
 * The real Better Auth configuration over a database that is never reached:
 * generating the OpenAPI document only reads the options.
 */
export function stubAuth(): Auth {
  return createAuth({
    db: {} as never,
    settings: {
      appUrl: STUB_APP_URL,
      secret: 'openapi-spec-secret-at-least-32-characters',
      google: { clientId: 'google', clientSecret: 'google' },
      facebook: { clientId: 'facebook', clientSecret: 'facebook' },
    },
    mailer: { dispatch: () => {} },
  });
}
