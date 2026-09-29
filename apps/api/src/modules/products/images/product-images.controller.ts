import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  productImageSchema,
  reorderProductImagesSchema,
  type ProductImage,
  type ReorderProductImages,
} from '@app/shared';
import { z } from 'zod';
import { CodedValidationException } from '../../../common/errors/coded-exceptions';
import { TenantGuard, tenantScope, type TenantRequest } from '../../../common/tenant.guard';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { ApiCodedError } from '../../../openapi/api-coded-error';
import { ProductImageUploadInterceptor } from './product-image-upload.interceptor';
import { ProductImagesService } from './product-images.service';

const uuidParam = new ZodValidationPipe(z.string().uuid());
const imageSchema = z.toJSONSchema(productImageSchema, {
  target: 'openapi-3.0',
  io: 'output',
}) as SchemaObject;

/** The merchant always comes from the session via TenantGuard, never the request. */
@ApiTags('Product images')
@UseGuards(TenantGuard)
@Controller('products/:productId/images')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseInterceptors(ProductImageUploadInterceptor)
  @ApiOperation({
    summary: 'Upload a product image',
    description:
      'Adds one JPEG, PNG or WebP image (max 10 MB) to the end of the gallery. The server strips all metadata and stores a 2048px JPEG and a 400px thumbnail.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ description: 'The stored image.', schema: imageSchema })
  @ApiCodedError(400, ['VALIDATION_FAILED', 'PRODUCT_IMAGE_INVALID'])
  @ApiCodedError(404, ['PRODUCT_NOT_FOUND'])
  @ApiCodedError(409, ['PRODUCT_IMAGE_LIMIT_REACHED'])
  @ApiCodedError(413, ['PRODUCT_IMAGE_TOO_LARGE'])
  @ApiCodedError(415, ['PRODUCT_IMAGE_UNSUPPORTED_TYPE'])
  @ApiCodedError(503, ['STORAGE_UNAVAILABLE'])
  upload(
    @Req() request: TenantRequest,
    @Param('productId', uuidParam) productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ProductImage> {
    if (!file) {
      throw new CodedValidationException({
        file: [{ code: 'REQUIRED', message: 'Attach an image in the `file` field', params: {} }],
      });
    }
    return this.images.upload(tenantScope(request), productId, file.buffer);
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a product image',
    description: 'Later images move up one position.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['PRODUCT_IMAGE_NOT_FOUND'])
  delete(
    @Req() request: TenantRequest,
    @Param('productId', uuidParam) productId: string,
    @Param('imageId', uuidParam) imageId: string,
  ): Promise<void> {
    return this.images.delete(tenantScope(request), productId, imageId);
  }

  @Put('order')
  @ApiOperation({
    summary: 'Reorder product images',
    description:
      "`imageIds` must list each of the product's images exactly once; the first becomes the cover.",
  })
  @ApiBody({
    schema: z.toJSONSchema(reorderProductImagesSchema, {
      target: 'openapi-3.0',
      io: 'input',
    }) as SchemaObject,
  })
  @ApiOkResponse({
    description: 'The gallery in its new order.',
    schema: { type: 'array', items: imageSchema },
  })
  @ApiCodedError(400, ['VALIDATION_FAILED', 'PRODUCT_IMAGE_ORDER_MISMATCH'])
  @ApiCodedError(404, ['PRODUCT_NOT_FOUND'])
  reorder(
    @Req() request: TenantRequest,
    @Param('productId', uuidParam) productId: string,
    @Body(new ZodValidationPipe(reorderProductImagesSchema)) body: ReorderProductImages,
  ): Promise<ProductImage[]> {
    return this.images.reorder(tenantScope(request), productId, body.imageIds);
  }
}
