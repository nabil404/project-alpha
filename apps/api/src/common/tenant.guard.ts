import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { TenantScope } from '../modules/database/base.repository';
import { CodedForbiddenException } from './errors/coded-exceptions';

export interface TenantRequest extends Request {
  merchantId?: string;
  /** Better Auth's `{ session, user }`, put there by SessionGuard. */
  session?: UserSession | null;
}

/**
 * Puts the session's active organization on the request as the merchant.
 * Repositories still take merchantId and filter by it. It runs after the
 * global SessionGuard, so the request is already authenticated.
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

/** The scope TenantGuard put on the request. Throws if a tenant route forgot the guard. */
export function tenantScope(request: TenantRequest): TenantScope {
  if (!request.merchantId) {
    throw new Error('TenantGuard did not run before a tenant route');
  }
  return { merchantId: request.merchantId };
}
