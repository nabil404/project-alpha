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
  type SchemaObject,
} from '@nestjs/swagger';
import {
  categoryWithCountSchema,
  createCategorySchema,
  updateCategorySchema,
  type CategoryWithCount,
  type CreateCategory,
  type UpdateCategory,
} from '@app/shared';
import { z } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { CategoriesService } from './categories.service';

const uuidParam = new ZodValidationPipe(z.string().uuid());
const json = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;
const categoryJson = json(categoryWithCountSchema, 'output');

/** The merchant always comes from the session via TenantGuard, never the request. */
@ApiTags('Categories')
@UseGuards(TenantGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'List categories',
    description:
      "The seller's live categories, a flat list, sorted by name. `productCount` counts every product in the category, whatever its status.",
  })
  @ApiOkResponse({
    description: 'Every live category.',
    schema: { type: 'array', items: categoryJson },
  })
  list(@Req() request: TenantRequest): Promise<CategoryWithCount[]> {
    return this.categories.list(tenantScope(request).merchantId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a category',
    description: 'The name is trimmed and must not match another live category, ignoring case.',
  })
  @ApiBody({ schema: json(createCategorySchema, 'input') })
  @ApiCreatedResponse({ description: 'The category.', schema: categoryJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(409, ['CATEGORY_NAME_TAKEN'])
  create(
    @Req() request: TenantRequest,
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategory,
  ): Promise<CategoryWithCount> {
    return this.categories.create(tenantScope(request).merchantId, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Rename a category',
    description: 'The name is trimmed and must not match another live category, ignoring case.',
  })
  @ApiBody({ schema: json(updateCategorySchema, 'input') })
  @ApiOkResponse({ description: 'The category.', schema: categoryJson })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CATEGORY_NOT_FOUND'])
  @ApiCodedError(409, ['CATEGORY_NAME_TAKEN'])
  update(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategory,
  ): Promise<CategoryWithCount> {
    return this.categories.update(tenantScope(request).merchantId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a category',
    description:
      'A soft delete: the category leaves every product it was on, and its name is free again. Products themselves are untouched.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CATEGORY_NOT_FOUND'])
  remove(@Req() request: TenantRequest, @Param('id', uuidParam) id: string): Promise<void> {
    return this.categories.remove(tenantScope(request).merchantId, id);
  }
}
