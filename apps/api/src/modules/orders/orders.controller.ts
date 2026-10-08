import {
  Body,
  Controller,
  Get,
  Headers,
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
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import {
  createOrderSchema,
  deliveryQuoteRequestSchema,
  deliveryQuoteSchema,
  listOrdersQuerySchema,
  orderDetailSchema,
  orderEventSchema,
  orderFilters,
  orderListResponseSchema,
  orderPageSizes,
  orderSorts,
  orderSummaryQuerySchema,
  orderSummarySchema,
  replaceOrderItemsSchema,
  sortDirections,
  updateOrderSchema,
  updateOrderStatusSchema,
  type CreateOrder,
  type DeliveryQuote,
  type DeliveryQuoteRequest,
  type ListOrdersQuery,
  type OrderDetail,
  type OrderEvent,
  type OrderListResponse,
  type OrderSummary,
  type OrderSummaryQuery,
  type ReplaceOrderItems,
  type UpdateOrder,
  type UpdateOrderStatus,
} from '@app/shared';
import { z, type ZodType } from 'zod';
import { parseOrThrow } from '../../common/parse-or-throw';
import { TenantGuard, tenantScope, type TenantRequest } from '../../common/tenant.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiCodedError } from '../../openapi/api-coded-error';
import { DeliveryQuoteService } from './delivery-quote.service';
import { OrdersService, type OrderActor } from './orders.service';

const uuidParam = new ZodValidationPipe(z.string().uuid());
/** Parsed under the header's name, so a bad key reports as that field. */
const idempotencyHeader = z.object({
  'Idempotency-Key': z.string().trim().min(1).max(200).optional(),
});
const openApi = (schema: ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;

const instantQuery = { required: false, schema: { type: 'string', format: 'date-time' } } as const;
const fromQuery = {
  name: 'from',
  description: 'Placed at or after this instant.',
  ...instantQuery,
};
const toQuery = { name: 'to', description: 'Placed before this instant.', ...instantQuery };

/** The seller making the change; SessionGuard always runs first. */
function actor(request: TenantRequest): OrderActor {
  const user = request.session?.user;
  if (!user) throw new Error('SessionGuard did not run before an order route');
  return { id: user.id };
}

/** The merchant always comes from the session via TenantGuard, never the request. */
@ApiTags('Orders')
@UseGuards(TenantGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly quotes: DeliveryQuoteService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List orders',
    description:
      '`q` matches the order reference, whole or in part ("ORD-2026-00481", "2026-004"), a bare order number in any year ("481", "#481"), the customer’s name or phone (digits alone match a formatted number). `from` and `to` bound when the order was placed.',
  })
  @ApiQuery({ name: 'status', required: false, enum: [...orderFilters] })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string', maxLength: 100 } })
  @ApiQuery(fromQuery)
  @ApiQuery(toQuery)
  @ApiQuery({ name: 'sort', required: false, enum: [...orderSorts] })
  @ApiQuery({ name: 'direction', required: false, enum: [...sortDirections] })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', enum: [...orderPageSizes], default: 10 },
  })
  @ApiOkResponse({ description: 'A page of orders.', schema: openApi(orderListResponseSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  list(
    @Req() request: TenantRequest,
    @Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQuery,
  ): Promise<OrderListResponse> {
    return this.orders.list(tenantScope(request), query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Order stats and tab counts',
    description:
      'The tab counts follow `q`, `from` and `to` as the list does. The cards ignore them: orders awaiting confirmation, orders to ship, and revenue and the assistant’s share over the last 30 days and the 30 before. Cancelled and returned orders never count as revenue.',
  })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string', maxLength: 100 } })
  @ApiQuery(fromQuery)
  @ApiQuery(toQuery)
  @ApiOkResponse({
    description: 'The stat cards and tab counts.',
    schema: openApi(orderSummarySchema),
  })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  summary(
    @Req() request: TenantRequest,
    @Query(new ZodValidationPipe(orderSummaryQuerySchema)) query: OrderSummaryQuery,
  ): Promise<OrderSummary> {
    return this.orders.summary(tenantScope(request), query);
  }

  @Post()
  @ApiOperation({
    summary: 'Add an order by hand',
    description:
      'For a customer who has messaged the Page. It starts as `new`; stock moves when it is confirmed. Name, phone and address default to the customer’s details on file. `deliveryChargeId` links a Settings delivery charge and copies its area name, everywhere-else flag and estimate onto the order; `deliveryFee` is stored as sent (quote it with POST /orders/delivery-quote). Send an `Idempotency-Key` to make a retry safe: a repeat returns the order the first request created.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Up to 200 characters.' })
  @ApiBody({ schema: openApi(createOrderSchema, 'input') })
  @ApiCreatedResponse({ description: 'The order.', schema: openApi(orderDetailSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['CUSTOMER_NOT_FOUND', 'VARIANT_NOT_FOUND', 'DELIVERY_CHARGE_NOT_FOUND'])
  create(
    @Req() request: TenantRequest,
    @Headers('idempotency-key') header: string | undefined,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrder,
  ): Promise<OrderDetail> {
    const key = parseOrThrow(idempotencyHeader, { 'Idempotency-Key': header })['Idempotency-Key'];
    return this.orders.create(tenantScope(request), actor(request), body, key);
  }

  @Post('delivery-quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Quote the delivery fee for items to an area',
    description:
      "Each product costs its own charge for the area if it sets one, else the shop's; the fee is the highest, not the sum, and nothing once the subtotal reaches the shop's free-delivery threshold. Prices are the ones sent, else the catalog's. Writes nothing.",
  })
  @ApiBody({ schema: openApi(deliveryQuoteRequestSchema, 'input') })
  @ApiOkResponse({ description: 'The fee.', schema: openApi(deliveryQuoteSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['DELIVERY_CHARGE_NOT_FOUND', 'VARIANT_NOT_FOUND'])
  deliveryQuote(
    @Req() request: TenantRequest,
    @Body(new ZodValidationPipe(deliveryQuoteRequestSchema)) body: DeliveryQuoteRequest,
  ): Promise<DeliveryQuote> {
    return this.quotes.quote(tenantScope(request), body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an order' })
  @ApiOkResponse({ description: 'The order.', schema: openApi(orderDetailSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['ORDER_NOT_FOUND'])
  get(@Req() request: TenantRequest, @Param('id', uuidParam) id: string): Promise<OrderDetail> {
    return this.orders.get(tenantScope(request), id);
  }

  @Get(':id/activity')
  @ApiOperation({ summary: 'An order’s activity', description: 'Newest first.' })
  @ApiOkResponse({
    description: 'Every event.',
    schema: { type: 'array', items: openApi(orderEventSchema) },
  })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['ORDER_NOT_FOUND'])
  activity(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
  ): Promise<OrderEvent[]> {
    return this.orders.activity(tenantScope(request), id);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move an order to its next status',
    description:
      'Confirm, pack, ship, deliver, return or cancel. Confirming takes the items from stock; cancelling a confirmed order, or returning a delivered one, puts them back.',
  })
  @ApiBody({ schema: openApi(updateOrderStatusSchema, 'input') })
  @ApiOkResponse({ description: 'The updated order.', schema: openApi(orderDetailSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['ORDER_NOT_FOUND'])
  @ApiCodedError(409, ['ORDER_STALE', 'ORDER_INVALID_TRANSITION', 'ORDER_INSUFFICIENT_STOCK'])
  changeStatus(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateOrderStatusSchema)) body: UpdateOrderStatus,
  ): Promise<OrderDetail> {
    return this.orders.changeStatus(tenantScope(request), actor(request), id, body);
  }

  @Put(':id/items')
  @ApiOperation({
    summary: 'Replace an order’s items',
    description:
      'While the order is new or confirmed. A variant already on the order keeps its name, SKU and price unless `unitPrice` is sent; a new one is priced from the catalog. A confirmed order’s stock follows the change.',
  })
  @ApiBody({ schema: openApi(replaceOrderItemsSchema, 'input') })
  @ApiOkResponse({ description: 'The updated order.', schema: openApi(orderDetailSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['ORDER_NOT_FOUND', 'VARIANT_NOT_FOUND'])
  @ApiCodedError(409, ['ORDER_STALE', 'ORDER_NOT_EDITABLE', 'ORDER_INSUFFICIENT_STOCK'])
  replaceItems(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(replaceOrderItemsSchema)) body: ReplaceOrderItems,
  ): Promise<OrderDetail> {
    return this.orders.replaceItems(tenantScope(request), actor(request), id, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit an order',
    description:
      'Delivery details (name, phone, address, area, fee) until the order ships; payment, tracking number and the internal note at any time. Omit a field to leave it; a blank area, tracking number or note clears it. `deliveryChargeId` links a Settings delivery charge and copies its area name (unless `deliveryArea` is sent), everywhere-else flag and estimate; `null` unlinks and clears them. The fee is never recomputed. The customer’s own details never change.',
  })
  @ApiBody({ schema: openApi(updateOrderSchema, 'input') })
  @ApiOkResponse({ description: 'The updated order.', schema: openApi(orderDetailSchema) })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  @ApiCodedError(404, ['ORDER_NOT_FOUND', 'DELIVERY_CHARGE_NOT_FOUND'])
  @ApiCodedError(409, ['ORDER_STALE', 'ORDER_NOT_EDITABLE'])
  update(
    @Req() request: TenantRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateOrderSchema)) body: UpdateOrder,
  ): Promise<OrderDetail> {
    return this.orders.update(tenantScope(request), actor(request), id, body);
  }
}
