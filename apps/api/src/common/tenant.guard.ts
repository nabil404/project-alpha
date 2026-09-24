import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { CodedForbiddenException } from './errors/coded-exceptions.js';

export interface TenantRequest extends Request {
  merchantId?: string;
  /** Better Auth's `{ session, user }`, put there by SessionGuard. */
  session?: UserSession | null;
}

/**
 * Each seller can only ever see their own Pages, catalog, conversations, and
 * orders. The guard puts the active organization on the request; repositories
 * still take merchantId explicitly and filter by it.
 *
 * It runs after the global SessionGuard, so an anonymous request has already
 * been turned away with AUTH_UNAUTHENTICATED by the time it gets here.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const merchantId = request.session?.session.activeOrganizationId;

    if (!merchantId) {
      throw new CodedForbiddenException(
        'TENANT_NO_ACTIVE_MERCHANT',
        'No active merchant for this session',
      );
    }

    request.merchantId = merchantId;
    return true;
  }
}
