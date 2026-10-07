import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags, type SchemaObject } from '@nestjs/swagger';
import {
  notificationSettingsSchema,
  updateNotificationSettingsSchema,
  type NotificationSettings,
  type UpdateNotificationSettings,
} from '@app/shared';
import { z } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { NotificationSettingsService } from './notification-settings.service';

const json = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;

/** The signed-in person's id, from the session SessionGuard put on the request. */
function userIdOf(request: TenantRequest): string {
  const userId = request.session?.user.id;
  if (!userId) throw new Error('SessionGuard did not run before a notification settings route');
  return userId;
}

/** The merchant and the person both come from the session, never the request. */
@ApiTags('Settings')
@UseGuards(TenantGuard)
@Controller('settings/notifications')
export class NotificationSettingsController {
  constructor(private readonly notifications: NotificationSettingsService) {}

  @Get()
  @ApiOperation({
    summary: "Read the signed-in person's notification switches for the active shop",
    description:
      'Each person keeps their own switches per shop. One who has never changed them reads as the defaults: new orders and waiting customers on, the daily summary off.',
  })
  @ApiOkResponse({ schema: json(notificationSettingsSchema, 'output') })
  get(@Req() request: TenantRequest): Promise<NotificationSettings> {
    return this.notifications.get(tenantScope(request), userIdOf(request));
  }

  @Patch()
  @ApiOperation({
    summary: 'Turn notification emails on or off',
    description:
      "Omit a switch to leave it alone. Changes only the signed-in person's switches, never a teammate's.",
  })
  @ApiBody({ schema: json(updateNotificationSettingsSchema, 'input') })
  @ApiOkResponse({ schema: json(notificationSettingsSchema, 'output') })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  update(
    @Req() request: TenantRequest,
    @Body(new ZodValidationPipe(updateNotificationSettingsSchema)) body: UpdateNotificationSettings,
  ): Promise<NotificationSettings> {
    return this.notifications.update(tenantScope(request), userIdOf(request), body);
  }
}
