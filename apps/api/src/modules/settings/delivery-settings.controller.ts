import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags, type SchemaObject } from '@nestjs/swagger';
import {
  deliverySettingsSchema,
  saveDeliverySettingsSchema,
  type DeliverySettings,
  type SaveDeliverySettings,
} from '@app/shared';
import { z } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { DeliverySettingsService } from './delivery-settings.service';

const json = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;

/** The merchant always comes from the session via TenantGuard, never the request. */
@ApiTags('Settings')
@UseGuards(TenantGuard)
@Controller('settings/delivery')
export class DeliverySettingsController {
  constructor(private readonly delivery: DeliverySettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Read delivery charges by area, everywhere else and the free-delivery threshold',
    description:
      'Areas in the order listed. `everywhereElse` is null until the first save. Amounts are minor units of `currency`.',
  })
  @ApiOkResponse({ schema: json(deliverySettingsSchema, 'output') })
  get(@Req() request: TenantRequest): Promise<DeliverySettings> {
    return this.delivery.get(tenantScope(request).merchantId);
  }

  @Put()
  @ApiOperation({
    summary: 'Save the delivery charges page',
    description:
      'The whole page. A row with an `id` is updated, one without is added, and a named row left out is removed with its product charges; orders delivered there keep its name and estimate. Area names are trimmed and must differ ignoring case.',
  })
  @ApiBody({ schema: json(saveDeliverySettingsSchema, 'input') })
  @ApiOkResponse({ schema: json(deliverySettingsSchema, 'output') })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['DELIVERY_CHARGE_NOT_FOUND'])
  save(
    @Req() request: TenantRequest,
    @Body(new ZodValidationPipe(saveDeliverySettingsSchema)) body: SaveDeliverySettings,
  ): Promise<DeliverySettings> {
    return this.delivery.save(tenantScope(request).merchantId, body);
  }
}
