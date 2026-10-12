import { Injectable, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@thallesp/nestjs-better-auth';
import { CodedUnauthorizedException } from '../../common/errors/coded-exceptions';

/**
 * The global session guard: every route needs a session unless marked
 * @AllowAnonymous() or @OptionalAuth(). It extends the library's AuthGuard only
 * to reject with AUTH_UNAUTHENTICATED instead of a bare HTTP_401, which the SPA
 * uses to send the seller to sign-in. On success, `request.session` holds
 * Better Auth's `{ session, user }` for TenantGuard.
 */
@Injectable()
export class SessionGuard extends AuthGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context);
    } catch (error) {
      if (
        error instanceof UnauthorizedException &&
        !(error instanceof CodedUnauthorizedException)
      ) {
        throw new CodedUnauthorizedException('AUTH_UNAUTHENTICATED', 'Authentication required');
      }
      throw error;
    }
  }
}
