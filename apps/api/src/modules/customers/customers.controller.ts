import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import {
  createCustomerNoteSchema,
  customerDetailSchema,
  customerFilters,
  customerListResponseSchema,
  customerNoteSchema,
  customerOrderPageSchema,
  customerPageSizes,
  customerSorts,
  customerSummarySchema,
  listCustomerOrdersQuerySchema,
  listCustomersQuerySchema,
  sortDirections,
  updateCustomerSchema,
  type CreateCustomerNote,
  type CustomerDetail,
  type CustomerListResponse,
  type CustomerNote,
  type CustomerOrderPage,
  type CustomerSummary,
  type ListCustomerOrdersQuery,
  type ListCustomersQuery,
  type UpdateCustomer,
} from '@app/shared';
import { z, type ZodType } from 'zod';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { CustomersService } from './customers.service';

const uuidParam = new ZodValidationPipe(z.string().uuid());
const openApi = (schema: ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;

/** The note's author is the signed-in seller; SessionGuard always runs first. */
function author(request: TenantRequest): { id: string; name: string } {
  const user = request.session?.user;
  if (!user) throw new Error('SessionGuard did not run before a customer route');
  return { id: user.id, name: user.name };
}

/** The merchant always comes from the session via TenantGuard, never the request. */
@ApiTags('Customers')
@UseGuards(TenantGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({
    summary: 'List customers',
    description:
      'Everyone who has messaged the shop, with their order figures and status. `q` matches name, phone (digits alone match a formatted number) or area. Customers with no orders sort last in either direction. Cancelled and returned orders never count.',
  })
  @ApiQuery({ name: 'filter', required: false, enum: [...customerFilters] })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string', maxLength: 100 } })
  @ApiQuery({ name: 'sort', required: false, enum: [...customerSorts] })
  @ApiQuery({ name: 'direction', required: false, enum: [...sortDirections] })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', enum: [...customerPageSizes], default: 10 },
  })
  @ApiOkResponse({
    description: 'A page of customers.',
    schema: openApi(customerListResponseSchema),
  })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  list(
    @Req() request: TenantRequest,
    @Query(new ZodValidationPipe(listCustomersQuerySchema)) query: ListCustomersQuery,
  ): Promise<CustomerListResponse> {
    return this.customers.list(tenantScope(request), query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Customer stats and tab counts',
    description:
      'Counts per status, new customers and average order value over the last 30 days and the 30 before. Ignores search.',
  })
  @ApiOkResponse({ description: 'The stat cards.', schema: openApi(customerSummarySchema) })
  summary(@Req() request: TenantRequest): Promise<CustomerSummary> {
    return this.customers.summary(tenantScope(request));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer' })
  @ApiOkResponse({ description: 'The customer.', schema: openApi(customerDetailSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CUSTOMER_NOT_FOUND'])
  get(@Req() request: TenantRequest, @Param('id', uuidParam) id: string): Promise<CustomerDetail> {
    return this.customers.get(tenantScope(request), id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a customer’s contact details',
    description:
      'Phone, delivery address and area. Omit a field to leave it; send `null` or a blank string to clear it. Orders keep the details they were placed with.',
  })
  @ApiBody({ schema: openApi(updateCustomerSchema, 'input') })
  @ApiOkResponse({ description: 'The updated customer.', schema: openApi(customerDetailSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CUSTOMER_NOT_FOUND'])
  update(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomer,
  ): Promise<CustomerDetail> {
    return this.customers.update(tenantScope(request), id, body);
  }

  @Get(':id/orders')
  @ApiOperation({
    summary: 'List a customer’s orders',
    description: 'Newest first, cancelled included.',
  })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
  })
  @ApiOkResponse({ description: 'A page of orders.', schema: openApi(customerOrderPageSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CUSTOMER_NOT_FOUND'])
  orders(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Query(new ZodValidationPipe(listCustomerOrdersQuerySchema)) query: ListCustomerOrdersQuery,
  ): Promise<CustomerOrderPage> {
    return this.customers.orders(tenantScope(request), id, query);
  }

  @Get(':id/notes')
  @ApiOperation({ summary: 'List notes on a customer', description: 'Newest first.' })
  @ApiOkResponse({
    description: 'Every note.',
    schema: { type: 'array', items: openApi(customerNoteSchema) },
  })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CUSTOMER_NOT_FOUND'])
  notes(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
  ): Promise<CustomerNote[]> {
    return this.customers.listNotes(tenantScope(request), id);
  }

  @Post(':id/notes')
  @ApiOperation({
    summary: 'Add a note on a customer',
    description: 'Seen only by the shop’s team, never the customer.',
  })
  @ApiBody({ schema: openApi(createCustomerNoteSchema, 'input') })
  @ApiCreatedResponse({ description: 'The note.', schema: openApi(customerNoteSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CUSTOMER_NOT_FOUND'])
  addNote(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(createCustomerNoteSchema)) body: CreateCustomerNote,
  ): Promise<CustomerNote> {
    return this.customers.addNote(tenantScope(request), id, author(request), body);
  }
}
