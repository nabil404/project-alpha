import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

export interface TenantRequest extends Request {
  merchantId?: string;
  session?: { activeOrganizationId?: string };
}

/**
 * Each seller can only ever see their own Pages, catalog, conversations, and
 * orders. The guard puts the active organization on the request; repositories
 * still take merchantId explicitly and filter by it.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const merchantId = request.session?.activeOrganizationId;

    if (!merchantId) {
      throw new ForbiddenException('No active merchant for this session');
    }

    request.merchantId = merchantId;
    return true;
  }
}
