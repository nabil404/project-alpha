import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags, type SchemaObject } from '@nestjs/swagger';
import {
  adProductListResponseSchema,
  adProductSchema,
  updateAdProductSchema,
  type AdProduct,
  type AdProductListResponse,
  type UpdateAdProduct,
} from '@app/shared';
import { z } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../../common/tenant.guard';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { ApiCodedError } from '../../../openapi/api-coded-error';
import { AdProductsService } from './ad-products.service';

const json = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;

const uuidParam = new ZodValidationPipe(z.string().uuid());

/** The shop comes from the session, never the request. */
@ApiTags('Messenger')
@UseGuards(TenantGuard)
@Controller('messenger/ads')
export class AdProductsController {
  constructor(private readonly ads: AdProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'List click-to-Messenger ads seen in chats',
    description: 'Newest first. `product` is null until the seller maps the ad.',
  })
  @ApiOkResponse({ schema: json(adProductListResponseSchema, 'output') })
  list(@Req() request: TenantRequest): Promise<AdProductListResponse> {
    return this.ads.list(tenantScope(request));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Map an ad to a product, or unmap it',
    description: 'A null `productId` unmaps. A Draft product is allowed; an archived one is not.',
  })
  @ApiBody({ schema: json(updateAdProductSchema, 'input') })
  @ApiOkResponse({ schema: json(adProductSchema, 'output') })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['AD_PRODUCT_NOT_FOUND', 'PRODUCT_NOT_FOUND'])
  @ApiCodedError(409, ['AD_PRODUCT_ARCHIVED'])
  setProduct(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateAdProductSchema)) body: UpdateAdProduct,
  ): Promise<AdProduct> {
    return this.ads.setProduct(tenantScope(request), id, body);
  }
}
