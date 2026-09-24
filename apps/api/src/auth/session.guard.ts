import { Injectable, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@thallesp/nestjs-better-auth';
import { CodedUnauthorizedException } from '../common/errors/coded-exceptions.js';

/**
 * The library's AuthGuard, registered globally in AppModule: every route needs
 * a session unless it is marked @AllowAnonymous() or @OptionalAuth().
 *
 * It exists only to give the rejection a code. The base guard throws a bare
 * UnauthorizedException, which AllExceptionsFilter would send as HTTP_401; the
 * SPA needs AUTH_UNAUTHENTICATED to know to send the seller to sign-in.
 *
 * On success it leaves `request.session` as Better Auth's `{ session, user }`,
 * which TenantGuard reads the active organization from.
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
