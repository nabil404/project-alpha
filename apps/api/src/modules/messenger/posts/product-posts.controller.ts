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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  createProductPostSchema,
  pagePostListResponseSchema,
  productPostListResponseSchema,
  productPostSchema,
  updateProductPostSchema,
  type CreateProductPost,
  type PagePostListResponse,
  type ProductPost,
  type ProductPostListResponse,
  type UpdateProductPost,
} from '@app/shared';
import { z } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../../common/tenant.guard';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { ApiCodedError } from '../../../openapi/api-coded-error';
import { openApiSchema } from '../../../openapi/openapi-schema';
import { ProductPostsService } from './product-posts.service';

const uuidParam = new ZodValidationPipe(z.string().uuid());

/** The shop comes from the session, never the request. */
@ApiTags('Catalog')
@UseGuards(TenantGuard)
@Controller('products/:productId/posts')
export class ProductPostsController {
  constructor(private readonly posts: ProductPostsService) {}

  @Get()
  @ApiOperation({
    summary: "List a product's Facebook posts",
    description: 'Linked by the seller, or suggested by the assistant. Newest first.',
  })
  @ApiOkResponse({ schema: openApiSchema(productPostListResponseSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['PRODUCT_NOT_FOUND'])
  list(
    @Req() request: TenantRequest,
    @Param('productId', uuidParam) productId: string,
  ): Promise<ProductPostListResponse> {
    return this.posts.list(tenantScope(request), productId);
  }

  @Post()
  @ApiOperation({
    summary: 'Link a Facebook post to a product',
    description:
      "A pasted post link, or one of the Page's posts by its Graph id. A post the assistant " +
      'suggested for any product becomes linked to this one. A short `share/` or fb.me link is ' +
      'followed one redirect.',
  })
  @ApiBody({ schema: openApiSchema(createProductPostSchema, 'input') })
  @ApiCreatedResponse({ schema: openApiSchema(productPostSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED', 'PRODUCT_POST_INVALID_URL'])
  @ApiCodedError(404, ['PRODUCT_NOT_FOUND'])
  @ApiCodedError(409, [
    'PRODUCT_POST_TAKEN',
    'PRODUCT_POST_ARCHIVED',
    'MESSENGER_PAGE_NOT_CONNECTED',
    'FACEBOOK_PERMISSION_MISSING',
  ])
  @ApiCodedError(503, ['MESSENGER_NOT_CONFIGURED', 'FACEBOOK_UNAVAILABLE'])
  create(
    @Req() request: TenantRequest,
    @Param('productId', uuidParam) productId: string,
    @Body(new ZodValidationPipe(createProductPostSchema)) body: CreateProductPost,
  ): Promise<ProductPost> {
    return this.posts.create(tenantScope(request), productId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Accept the assistant's suggested post" })
  @ApiBody({ schema: openApiSchema(updateProductPostSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(productPostSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['PRODUCT_POST_NOT_FOUND', 'PRODUCT_NOT_FOUND'])
  @ApiCodedError(409, ['PRODUCT_POST_TAKEN', 'PRODUCT_POST_ARCHIVED'])
  accept(
    @Req() request: TenantRequest,
    @Param('productId', uuidParam) productId: string,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateProductPostSchema)) _body: UpdateProductPost,
  ): Promise<ProductPost> {
    return this.posts.accept(tenantScope(request), productId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlink a post, or dismiss a suggestion' })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['PRODUCT_POST_NOT_FOUND'])
  remove(
    @Req() request: TenantRequest,
    @Param('productId', uuidParam) productId: string,
    @Param('id', uuidParam) id: string,
  ): Promise<void> {
    return this.posts.remove(tenantScope(request), productId, id);
  }
}

@ApiTags('Messenger')
@UseGuards(TenantGuard)
@Controller('messenger/page-posts')
export class PagePostsController {
  constructor(private readonly posts: ProductPostsService) {}

  @Get()
  @ApiOperation({
    summary: "List the connected Page's recent posts",
    description:
      'The newest 25, for linking posts to products, each with the product it is linked to. ' +
      'Needs `pages_read_engagement`.',
  })
  @ApiOkResponse({ schema: openApiSchema(pagePostListResponseSchema) })
  @ApiCodedError(409, ['MESSENGER_PAGE_NOT_CONNECTED', 'FACEBOOK_PERMISSION_MISSING'])
  @ApiCodedError(503, ['MESSENGER_NOT_CONFIGURED', 'FACEBOOK_UNAVAILABLE'])
  list(@Req() request: TenantRequest): Promise<PagePostListResponse> {
    return this.posts.pagePosts(tenantScope(request));
  }
}
