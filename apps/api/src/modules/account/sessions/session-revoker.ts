import type { AuthService } from '@thallesp/nestjs-better-auth';
import type { Auth } from '../../auth/auth.module';

/** Ends one session by its token. Abstract so the service can be tested without Better Auth. */
export abstract class SessionRevoker {
  abstract revoke(token: string): Promise<void>;
}

/**
 * Through Better Auth's internal adapter rather than a DELETE on the table, so
 * a cookie cache or secondary storage configured later is cleared too.
 */
export class BetterAuthSessionRevoker extends SessionRevoker {
  constructor(private readonly auth: AuthService<Auth>) {
    super();
  }

  async revoke(token: string): Promise<void> {
    const context = await this.auth.instance.$context;
    await context.internalAdapter.deleteSession(token);
  }
}
