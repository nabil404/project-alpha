import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  activateImportResultSchema,
  activateImportSchema,
  createImportSchema,
  facebookImportAccessSchema,
  IMPORT_LIST_PAGE_SIZES,
  importPostFilters,
  importPostListResponseSchema,
  importPostSchema,
  importRunListResponseSchema,
  importRunSchema,
  listImportPostsQuerySchema,
  productImportSourceSchema,
  listImportsQuerySchema,
  type ActivateImport,
  type ActivateImportResult,
  type CreateImport,
  type FacebookImportAccess,
  type ImportPost,
  type ImportPostListResponse,
  type ImportRun,
  type ImportRunListResponse,
  type ListImportPostsQuery,
  type ListImportsQuery,
  type ProductImportSource,
} from '@app/shared';
import { z } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { openApiSchema } from '../../openapi/openapi-schema';
import { ImportsService } from './imports.service';

const uuidParam = new ZodValidationPipe(z.string().uuid());
const runJson = openApiSchema(importRunSchema);
const pageQuery = ApiQuery({
  name: 'page',
  required: false,
  schema: { type: 'integer', minimum: 1, default: 1 },
});
const limitQuery = ApiQuery({
  name: 'limit',
  required: false,
  schema: { type: 'integer', enum: [...IMPORT_LIST_PAGE_SIZES], default: 10 },
});

/** Catalog > Import from Facebook posts. The merchant always comes from the session via TenantGuard. */
@ApiTags('Imports')
@UseGuards(TenantGuard)
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start an import from Facebook posts',
    description:
      "Reads the connected Page's posts between `since` and `until`, dates in the shop's time zone, into draft products. `until` is not after today, and the range is at most 366 days. The run goes on in the background; poll GET /imports/:id.",
  })
  @ApiBody({ schema: openApiSchema(createImportSchema, 'input') })
  @ApiAcceptedResponse({ description: 'The queued run.', schema: runJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(409, [
    'MESSENGER_PAGE_NOT_CONNECTED',
    'FACEBOOK_PERMISSION_MISSING',
    'IMPORT_ALREADY_RUNNING',
  ])
  @ApiCodedError(503, ['IMPORT_NOT_AVAILABLE', 'FACEBOOK_UNAVAILABLE'])
  create(
    @Req() request: TenantRequest,
    @Body(new ZodValidationPipe(createImportSchema)) body: CreateImport,
  ): Promise<ImportRun> {
    return this.imports.create(tenantScope(request), request.session?.user.id ?? null, body);
  }

  @Get('facebook/access')
  @ApiOperation({
    summary: "Check the Page's posts can be read",
    description:
      'One Graph call with the Page token. `canReadPosts` is false when the Page was connected without `pages_read_engagement`; the seller reconnects it.',
  })
  @ApiOkResponse({ schema: openApiSchema(facebookImportAccessSchema) })
  @ApiCodedError(503, ['MESSENGER_NOT_CONFIGURED', 'FACEBOOK_UNAVAILABLE'])
  access(@Req() request: TenantRequest): Promise<FacebookImportAccess> {
    return this.imports.access(tenantScope(request));
  }

  @Get('products/:productId')
  @ApiOperation({
    summary: 'Get the post a product was imported from',
    description:
      'The post that made the product, or the first merged into it. `source` is null for a product no import made, or one that does not exist.',
  })
  @ApiOkResponse({ schema: openApiSchema(productImportSourceSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  productSource(
    @Req() request: TenantRequest,
    @Param('productId', uuidParam) productId: string,
  ): Promise<ProductImportSource> {
    return this.imports.productSource(tenantScope(request), productId);
  }

  @Get()
  @ApiOperation({ summary: 'List import runs', description: 'Newest first, every run kept.' })
  @pageQuery
  @limitQuery
  @ApiOkResponse({ schema: openApiSchema(importRunListResponseSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  list(
    @Req() request: TenantRequest,
    @Query(new ZodValidationPipe(listImportsQuerySchema)) query: ListImportsQuery,
  ): Promise<ImportRunListResponse> {
    return this.imports.list(tenantScope(request), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an import run', description: 'Its status and counts so far.' })
  @ApiOkResponse({ schema: runJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['IMPORT_NOT_FOUND'])
  get(@Req() request: TenantRequest, @Param('id', uuidParam) id: string): Promise<ImportRun> {
    return this.imports.get(tenantScope(request), id);
  }

  @Get(':id/posts')
  @ApiOperation({
    summary: "List a run's posts",
    description:
      'Latest handled first. `needs_info` and `ready` list posts whose drafts are still drafts, missing a price or priced throughout, with only those drafts; `skipped` lists posts that were not a product or already in the catalog.',
  })
  @ApiQuery({ name: 'result', required: false, enum: [...importPostFilters] })
  @pageQuery
  @limitQuery
  @ApiOkResponse({ schema: openApiSchema(importPostListResponseSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['IMPORT_NOT_FOUND'])
  posts(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Query(new ZodValidationPipe(listImportPostsQuerySchema)) query: ListImportPostsQuery,
  ): Promise<ImportPostListResponse> {
    return this.imports.posts(tenantScope(request), id, query);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop an import',
    description: 'The run stops after the post it is reading, and can be resumed.',
  })
  @ApiOkResponse({ schema: runJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['IMPORT_NOT_FOUND'])
  @ApiCodedError(409, ['IMPORT_NOT_RUNNING'])
  stop(@Req() request: TenantRequest, @Param('id', uuidParam) id: string): Promise<ImportRun> {
    return this.imports.stop(tenantScope(request), id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Resume a stopped import',
    description: 'It goes on from the page of posts it stopped on and skips the posts it handled.',
  })
  @ApiAcceptedResponse({ schema: runJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['IMPORT_NOT_FOUND'])
  @ApiCodedError(409, ['IMPORT_NOT_STOPPED', 'IMPORT_ALREADY_RUNNING'])
  resume(@Req() request: TenantRequest, @Param('id', uuidParam) id: string): Promise<ImportRun> {
    return this.imports.resume(tenantScope(request), id);
  }

  @Post(':id/posts/:postId/import')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Import a skipped post anyway',
    description:
      "A post already in the catalog becomes drafts with no catalog match. A post read as not a product, or as products with no name, is read again with the hint that it holds one, and its products are matched against the catalog as a run's are. A post with no caption and no photo, or imported before, is refused. The post comes back with `importAnyway: queued`; the job runs in the background, even while another run goes, and leaves `no_product` or `failed` there when it makes no drafts.",
  })
  @ApiAcceptedResponse({
    description: 'The post as it is now.',
    schema: openApiSchema(importPostSchema),
  })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['IMPORT_NOT_FOUND', 'IMPORT_POST_NOT_FOUND'])
  @ApiCodedError(409, ['IMPORT_POST_NOT_SKIPPED'])
  @ApiCodedError(503, ['IMPORT_NOT_AVAILABLE'])
  importAnyway(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Param('postId', uuidParam) postId: string,
  ): Promise<ImportPost> {
    return this.imports.importAnyway(tenantScope(request), id, postId);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Activate a run's drafts",
    description:
      "Sets `startingStock` on every live variant with no stock, then makes each product active, one product per transaction. A product that is not this run's, not a draft, or still missing a price comes back in `failed` with its code; the rest go ahead.",
  })
  @ApiBody({ schema: openApiSchema(activateImportSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(activateImportResultSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['IMPORT_NOT_FOUND'])
  activate(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(activateImportSchema)) body: ActivateImport,
  ): Promise<ActivateImportResult> {
    return this.imports.activate(tenantScope(request), id, body);
  }
}
