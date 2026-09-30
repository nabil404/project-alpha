import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import {
  createProductSchema,
  listProductsQuerySchema,
  PRODUCT_LIST_PAGE_SIZES,
  productCountsSchema,
  productListFilters,
  productListResponseSchema,
  productSchema,
  saveProductSchema,
  updateProductSchema,
  updateVariantSchema,
  type CreateProduct,
  type ListProductsQuery,
  type Product,
  type ProductCounts,
  type ProductListResponse,
  type SaveProduct,
  type UpdateProduct,
  type UpdateVariant,
} from '@app/shared';
import { z } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { ProductsService } from './products.service';

const uuidParam = new ZodValidationPipe(z.string().uuid());
const json = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;
const productJson = json(productSchema, 'output');

/** The merchant always comes from the session via TenantGuard, never the request. */
@ApiTags('Products')
@UseGuards(TenantGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a product',
    description:
      'Options and variants come in one document; photos are added afterwards through the image routes.',
  })
  @ApiBody({ schema: json(createProductSchema, 'input') })
  @ApiCreatedResponse({ description: 'The product.', schema: productJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CATEGORY_NOT_FOUND'])
  @ApiCodedError(409, ['SKU_TAKEN'])
  create(
    @Req() request: TenantRequest,
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProduct,
  ): Promise<Product> {
    return this.products.create(tenantScope(request).merchantId, body);
  }

  @Get()
  @ApiOperation({
    summary: 'List products',
    description:
      "Newest first, a page at a time, with each product's live variants summed up. A product with one variant carries it as `variant`; the rest load through GET /products/:id. `all` and the stock filters leave archived products out. `q` matches the name, a tag or a SKU; `categoryId` keeps products in that category.",
  })
  @ApiQuery({ name: 'filter', required: false, enum: [...productListFilters] })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string', maxLength: 100 } })
  @ApiQuery({ name: 'categoryId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', enum: [...PRODUCT_LIST_PAGE_SIZES], default: 10 },
  })
  @ApiOkResponse({
    description: 'A page of products.',
    schema: json(productListResponseSchema, 'output'),
  })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  list(
    @Req() request: TenantRequest,
    @Query(new ZodValidationPipe(listProductsQuerySchema)) query: ListProductsQuery,
  ): Promise<ProductListResponse> {
    return this.products.list(tenantScope(request).merchantId, query);
  }

  @Get('counts')
  @ApiOperation({
    summary: 'Count products per filter',
    description: 'For the filter chips and the stock banner. Ignores search and category.',
  })
  @ApiOkResponse({ description: 'Counts per filter.', schema: json(productCountsSchema, 'output') })
  counts(@Req() request: TenantRequest): Promise<ProductCounts> {
    return this.products.counts(tenantScope(request).merchantId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a product',
    description: 'Any status, with options, live variants and photos.',
  })
  @ApiOkResponse({ description: 'The product.', schema: productJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['PRODUCT_NOT_FOUND'])
  get(@Req() request: TenantRequest, @Param('id', uuidParam) id: string): Promise<Product> {
    return this.products.get(tenantScope(request).merchantId, id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Save a product',
    description:
      "Replaces the product's fields, options and variants with the document, in one transaction. Options, values and variants left out are removed (variants archived). `version` must be the one last read, or the save is refused with PRODUCT_STALE.",
  })
  @ApiBody({ schema: json(saveProductSchema, 'input') })
  @ApiOkResponse({ description: 'The saved product.', schema: productJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, [
    'PRODUCT_NOT_FOUND',
    'PRODUCT_OPTION_NOT_FOUND',
    'VARIANT_NOT_FOUND',
    'CATEGORY_NOT_FOUND',
  ])
  @ApiCodedError(409, ['PRODUCT_STALE', 'SKU_TAKEN'])
  save(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(saveProductSchema)) body: SaveProduct,
  ): Promise<Product> {
    return this.products.save(tenantScope(request).merchantId, id, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update product fields',
    description:
      'Changes only the fields sent, such as the status. `categoryIds`, when sent, replaces the links.',
  })
  @ApiBody({ schema: json(updateProductSchema, 'input') })
  @ApiOkResponse({ description: 'The product.', schema: productJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['PRODUCT_NOT_FOUND', 'CATEGORY_NOT_FOUND'])
  update(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProduct,
  ): Promise<Product> {
    return this.products.update(tenantScope(request).merchantId, id, body);
  }

  @Patch(':id/variants/:variantId')
  @ApiOperation({
    summary: 'Update one variant',
    description:
      "Changes a live variant's SKU, price, stock or image without the whole document. Its option values change only through a save. Bumps the product's version.",
  })
  @ApiBody({ schema: json(updateVariantSchema, 'input') })
  @ApiOkResponse({ description: 'The product.', schema: productJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'PRODUCT_IMAGE_NOT_FOUND'])
  @ApiCodedError(409, ['SKU_TAKEN'])
  updateVariant(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Param('variantId', uuidParam) variantId: string,
    @Body(new ZodValidationPipe(updateVariantSchema)) body: UpdateVariant,
  ): Promise<Product> {
    return this.products.updateVariant(tenantScope(request).merchantId, id, variantId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a product',
    description: 'Refused with PRODUCT_IN_USE once orders reference it; archive it instead.',
  })
  @ApiNoContentResponse({ description: 'Deleted, with its photos.' })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['PRODUCT_NOT_FOUND'])
  @ApiCodedError(409, ['PRODUCT_IN_USE'])
  remove(@Req() request: TenantRequest, @Param('id', uuidParam) id: string): Promise<void> {
    return this.products.remove(tenantScope(request).merchantId, id);
  }
}
