import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  generalSettingsSchema,
  LOGO_MAX_BYTES,
  shopLogoSchema,
  updateGeneralSettingsSchema,
  type GeneralSettings,
  type ShopLogo,
  type UpdateGeneralSettings,
} from '@app/shared';
import { z } from 'zod';
import { CodedValidationException } from '../../common/errors/coded-exceptions';
import { ImageUploadInterceptor } from '../../common/image-upload.interceptor';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { GeneralSettingsService } from './general-settings.service';
import { ShopLogoService } from './logo/shop-logo.service';

const json = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;

const LogoUploadInterceptor = ImageUploadInterceptor({
  maxBytes: LOGO_MAX_BYTES,
  tooLargeCode: 'LOGO_TOO_LARGE',
  invalidCode: 'LOGO_INVALID',
  noun: 'logo',
});

/** The merchant always comes from the session via TenantGuard, never the request. */
@ApiTags('Settings')
@UseGuards(TenantGuard)
@Controller('settings/general')
export class GeneralSettingsController {
  constructor(
    private readonly settings: GeneralSettingsService,
    private readonly logos: ShopLogoService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Read the shop profile and region',
    description:
      'A shop that has never saved its region reads as the default one (Bangladesh). Codes only: the dashboard localizes country and currency names itself.',
  })
  @ApiOkResponse({ schema: json(generalSettingsSchema, 'output') })
  get(@Req() request: TenantRequest): Promise<GeneralSettings> {
    return this.settings.get(tenantScope(request).merchantId);
  }

  @Patch()
  @ApiOperation({
    summary: 'Change the shop profile or region',
    description:
      "Omit a field to leave it alone; a blank phone or address clears it. The phone is normalized to E.164. Choosing a country changes nothing else on its own - send the currency, time zone and date format it suggests too. The currency is fixed once the shop has an order; before that, changing it keeps every price's number and nothing is converted.",
  })
  @ApiBody({ schema: json(updateGeneralSettingsSchema, 'input') })
  @ApiOkResponse({ schema: json(generalSettingsSchema, 'output') })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(409, ['CURRENCY_LOCKED'])
  update(
    @Req() request: TenantRequest,
    @Body(new ZodValidationPipe(updateGeneralSettingsSchema)) body: UpdateGeneralSettings,
  ): Promise<GeneralSettings> {
    return this.settings.update(tenantScope(request).merchantId, body);
  }

  @Put('logo')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseInterceptors(LogoUploadInterceptor)
  @ApiOperation({
    summary: 'Set the shop logo',
    description:
      'One JPEG, PNG or WebP image (max 5 MB, at least 256 × 256). The server strips all metadata and stores a 512px square JPEG.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ description: 'The new logo URL.', schema: json(shopLogoSchema, 'output') })
  @ApiCodedError(400, ['VALIDATION_FAILED', 'LOGO_INVALID', 'LOGO_TOO_SMALL'])
  @ApiCodedError(413, ['LOGO_TOO_LARGE'])
  @ApiCodedError(415, ['LOGO_UNSUPPORTED_TYPE'])
  @ApiCodedError(503, ['STORAGE_UNAVAILABLE'])
  uploadLogo(
    @Req() request: TenantRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ShopLogo> {
    if (!file) {
      throw new CodedValidationException({
        file: [{ code: 'REQUIRED', message: 'Attach an image in the `file` field', params: {} }],
      });
    }
    return this.logos.upload(tenantScope(request).merchantId, file.buffer);
  }

  @Delete('logo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the shop logo' })
  @ApiOkResponse({ description: '`logo` is null.', schema: json(shopLogoSchema, 'output') })
  removeLogo(@Req() request: TenantRequest): Promise<ShopLogo> {
    return this.logos.remove(tenantScope(request).merchantId);
  }
}
