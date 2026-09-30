import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, type SchemaObject } from '@nestjs/swagger';
import { categorySchema, type Category } from '@app/shared';
import { z } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { CategoriesService } from './categories.service';

const categoryJson = z.toJSONSchema(categorySchema, {
  target: 'openapi-3.0',
  io: 'output',
}) as SchemaObject;

/** Read-only for now: the product edit page's picker. Category writes come with the Categories page. */
@ApiTags('Categories')
@UseGuards(TenantGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'List categories',
    description:
      "The seller's live categories, flat; build the tree (and paths like Women › Kurtis) from parentId.",
  })
  @ApiOkResponse({
    description: 'Every live category.',
    schema: { type: 'array', items: categoryJson },
  })
  list(@Req() request: TenantRequest): Promise<Category[]> {
    return this.categories.list(tenantScope(request).merchantId);
  }
}
