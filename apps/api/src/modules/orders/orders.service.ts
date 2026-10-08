import { Inject, Injectable } from '@nestjs/common';
import {
  canTransitionOrder,
  orderDeliveryEditable,
  orderItemsEditable,
  type CreateOrder,
  type FieldError,
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
import { CodedValidationException } from '../../common/errors/index';
import type { Executor, TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import type { OrderRow } from '../database/schema/index';
import { withMerchant } from '../database/with-merchant';
import { customerNotFound } from '../customers/customer-errors';
import { pagePagination } from '../customers/customer-mappers';
import { defaultMerchantSettings } from '../settings/general-settings.service';
import { DeliveryChargesRepository } from '../settings/delivery-charges.repository';
import { deliveryChargeNotFound } from '../settings/delivery-errors';
import { MerchantSettingsRepository } from '../settings/merchant-settings.repository';
import { OrderCatalogRepository } from './order-catalog.repository';
import {
  orderInsufficientStock,
  orderInvalidTransition,
  orderNotEditable,
  orderNotFound,
  orderStale,
} from './order-errors';
import { OrderEventsRepository } from './order-events.repository';
import { orderReference, orderYear } from './order-reference';
import { orderVersion, toOrderDetail, toOrderEvent, toOrderListItem } from './order-mappers';
import {
  buildLines,
  planOrderPatch,
  stockChanges,
  subtotalOf,
  variantLabel,
  type LinkedDelivery,
  type StockChange,
} from './order-rules';
import { OrdersRepository } from './orders.repository';

/** The signed-in seller making a change; recorded on the order's activity. */
export interface OrderActor {
  id: string;
}

const required = (message: string): FieldError[] => [{ code: 'REQUIRED', message, params: {} }];

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly orders: OrdersRepository,
    private readonly events: OrderEventsRepository,
    private readonly catalog: OrderCatalogRepository,
    private readonly settings: MerchantSettingsRepository,
    private readonly deliveryCharges: DeliveryChargesRepository,
  ) {}

  list(scope: TenantScope, query: ListOrdersQuery): Promise<OrderListResponse> {
    const { page, pageSize, ...rest } = query;
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const { rows, total } = await this.orders.list(tx, scope, {
        ...rest,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      });
      return {
        data: rows.map(toOrderListItem),
        pagination: pagePagination(page, pageSize, total),
      };
    });
  }

  summary(scope: TenantScope, query: OrderSummaryQuery): Promise<OrderSummary> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const counts = await this.orders.countByStatus(tx, scope, query);
      const cards = await this.orders.cards(tx, scope, new Date());
      return {
        counts,
        awaitingConfirmation: cards.awaitingConfirmation,
        toShip: { confirmed: cards.confirmed, packed: cards.packed },
        revenue: { currentWindow: cards.revenueCurrent, previousWindow: cards.revenuePrevious },
        placedInWindow: { all: cards.placedInWindow, byAssistant: cards.byAssistantInWindow },
      };
    });
  }

  get(scope: TenantScope, id: string): Promise<OrderDetail> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const row = await this.orders.find(tx, scope, id);
      if (!row) throw orderNotFound(id);
      return this.detail(tx, scope, row);
    });
  }

  activity(scope: TenantScope, id: string): Promise<OrderEvent[]> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.orders.find(tx, scope, id))) throw orderNotFound(id);
      return (await this.events.list(tx, scope, id)).map(toOrderEvent);
    });
  }

  /**
   * An order the seller enters by hand, for a customer who has messaged the
   * Page. It starts as `new`, so stock moves only when the seller confirms it,
   * as with one the assistant drafts. With an idempotency key, a repeat of the
   * same request returns the order the first one created.
   */
  create(
    scope: TenantScope,
    actor: OrderActor,
    input: CreateOrder,
    idempotencyKey?: string,
  ): Promise<OrderDetail> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      // The shop's settings row lock serializes order creation: it guards the
      // next number, the idempotency check, and the currency, which a settings
      // save may change only while the shop has no orders.
      const settings = await this.settings.lockOrCreate(tx, scope, defaultMerchantSettings());
      if (idempotencyKey) {
        const replay = await this.orders.findByIdempotencyKey(tx, scope, idempotencyKey);
        if (replay) return this.detail(tx, scope, replay);
      }

      const customer = await this.orders.findCustomer(tx, scope, input.customerId);
      if (!customer) throw customerNotFound(input.customerId);
      const customerName = input.customerName ?? customer.name;
      const phone = input.phone ?? customer.phone;
      const deliveryAddress = input.deliveryAddress ?? customer.deliveryAddress;
      const missing: Record<string, FieldError[]> = {};
      if (!customerName) missing.customerName = required('The customer has no name on file');
      if (!phone) missing.phone = required('The customer has no phone on file');
      if (!deliveryAddress)
        missing.deliveryAddress = required('The customer has no address on file');
      if (!customerName || !phone || !deliveryAddress) throw new CodedValidationException(missing);

      const variants = await this.catalog.findVariants(
        tx,
        scope,
        input.items.map((item) => item.variantId),
      );
      const lines = buildLines(input.items, [], variants);
      const subtotal = subtotalOf(lines);
      const placedAt = new Date();
      const row = await this.orders.insert(tx, scope, {
        ...(await this.numberFor(tx, scope, placedAt, settings.timeZone)),
        customerId: customer.id,
        conversationId: null,
        source: 'seller',
        status: 'new',
        paymentMethod: input.paymentMethod,
        subtotal,
        deliveryFee: input.deliveryFee,
        total: subtotal + input.deliveryFee,
        currency: settings.currency,
        customerName,
        phone,
        deliveryAddress,
        ...(input.deliveryChargeId !== undefined
          ? await this.deliveryColumns(tx, scope, input.deliveryChargeId, input.deliveryArea)
          : { deliveryArea: input.deliveryArea ?? null }),
        notes: input.note ?? null,
        idempotencyKey: idempotencyKey ?? null,
        placedAt,
      });
      await this.orders.replaceItems(tx, scope, row.id, lines);
      await this.events.insert(tx, scope, row.id, actor.id, [
        { type: 'created', source: 'seller' },
      ]);
      return this.detail(tx, scope, row);
    });
  }

  /**
   * Confirm, pack, ship, deliver, return or cancel. Stock is taken when the
   * order is confirmed and given back when it is cancelled after that, or
   * returned.
   */
  changeStatus(
    scope: TenantScope,
    actor: OrderActor,
    id: string,
    { status, note, version }: UpdateOrderStatus,
  ): Promise<OrderDetail> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const row = await this.lockForChange(tx, scope, id, version);
      if (!canTransitionOrder(row.status, status)) throw orderInvalidTransition(row.status, status);
      const lines = await this.orders.items(tx, scope, id);
      await this.moveStock(
        tx,
        scope,
        stockChanges({ lines, status: row.status }, { lines, status }),
      );
      const updated = await this.orders.update(tx, scope, id, { status });
      await this.events.insert(tx, scope, id, actor.id, [
        { type: 'status_changed', from: row.status, to: status, ...(note && { note }) },
      ]);
      return this.detail(tx, scope, updated);
    });
  }

  /** Replaces the lines while the order is new or confirmed; a confirmed order's stock follows the edit. */
  replaceItems(
    scope: TenantScope,
    actor: OrderActor,
    id: string,
    { items, version }: ReplaceOrderItems,
  ): Promise<OrderDetail> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const row = await this.lockForChange(tx, scope, id, version);
      if (!orderItemsEditable(row.status)) throw orderNotEditable(row.status);
      const current = await this.orders.items(tx, scope, id);
      const variants = await this.catalog.findVariants(
        tx,
        scope,
        items.map((item) => item.variantId),
      );
      const lines = buildLines(items, current, variants);
      await this.moveStock(
        tx,
        scope,
        stockChanges({ lines: current, status: row.status }, { lines, status: row.status }),
      );
      await this.orders.replaceItems(tx, scope, id, lines);
      const subtotal = subtotalOf(lines);
      const updated = await this.orders.update(tx, scope, id, {
        subtotal,
        total: subtotal + row.deliveryFee,
      });
      await this.events.insert(tx, scope, id, actor.id, [
        { type: 'items_changed', totalBefore: row.total, totalAfter: updated.total },
      ]);
      return this.detail(tx, scope, updated);
    });
  }

  /** Delivery details until the order ships; payment, tracking and the note at any time. */
  update(
    scope: TenantScope,
    actor: OrderActor,
    id: string,
    input: UpdateOrder,
  ): Promise<OrderDetail> {
    const { version, ...fields } = input;
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const row = await this.lockForChange(tx, scope, id, version);
      const linked =
        fields.deliveryChargeId !== undefined && fields.deliveryChargeId !== row.deliveryChargeId
          ? await this.deliveryColumns(tx, scope, fields.deliveryChargeId, fields.deliveryArea)
          : undefined;
      const { changes, events, touchesDelivery } = planOrderPatch(row, fields, linked);
      if (touchesDelivery && !orderDeliveryEditable(row.status)) throw orderNotEditable(row.status);
      // Nothing differs: no new version, so the page's copy stays current.
      if (Object.keys(changes).length === 0) return this.detail(tx, scope, row);
      const updated = await this.orders.update(tx, scope, id, changes);
      await this.events.insert(tx, scope, id, actor.id, events);
      return this.detail(tx, scope, updated);
    });
  }

  /**
   * What an order takes from the delivery charge it is priced by: the area's
   * name (unless one is given), whether it is everywhere else, and its
   * estimate. `null` unlinks and clears them, keeping a given name.
   */
  private async deliveryColumns(
    tx: Executor,
    scope: TenantScope,
    chargeId: string | null,
    area: string | null | undefined,
  ): Promise<LinkedDelivery> {
    if (chargeId === null) {
      return {
        deliveryChargeId: null,
        deliveryArea: area ?? null,
        deliveryEverywhereElse: false,
        deliveryTime: null,
      };
    }
    const row = await this.deliveryCharges.find(tx, scope, chargeId);
    if (!row) throw deliveryChargeNotFound(chargeId);
    return {
      deliveryChargeId: row.id,
      deliveryArea: area !== undefined ? area : row.areaName,
      deliveryEverywhereElse: row.isFallback,
      deliveryTime: row.deliveryTime,
    };
  }

  /** The order, locked until the transaction ends, provided the caller read its current version. */
  private async lockForChange(
    tx: Executor,
    scope: TenantScope,
    id: string,
    version: string,
  ): Promise<OrderRow> {
    const row = await this.orders.find(tx, scope, id, { lock: true });
    if (!row) throw orderNotFound(id);
    if (orderVersion(row) !== version) throw orderStale(id);
    return row;
  }

  /**
   * Applies the moves, products locked first in id order. Taking more than a
   * variant has refuses the whole change; the transaction rolls back any
   * move already made.
   */
  private async moveStock(tx: Executor, scope: TenantScope, changes: StockChange[]): Promise<void> {
    if (changes.length === 0) return;
    const productIds = [...new Set(changes.map((change) => change.productId))].sort();
    await this.catalog.lockAndBumpProducts(tx, scope, productIds);
    for (const { variantId, change } of changes) {
      if ((await this.catalog.adjustStock(tx, scope, variantId, change)) !== null) continue;
      const variant = (await this.catalog.findVariants(tx, scope, [variantId])).get(variantId);
      throw orderInsufficientStock({
        id: variantId,
        name: variant ? variantLabel(variant) : variantId,
        available: variant?.stock ?? 0,
      });
    }
  }

  /**
   * The year, number and reference for an order placed at `placedAt`. Every
   * path that creates an order takes the shop's settings row lock first and
   * then calls this, so two orders never share a number.
   */
  private async numberFor(
    tx: Executor,
    scope: TenantScope,
    placedAt: Date,
    timeZone: string,
  ): Promise<{ year: number; number: number; reference: string }> {
    const year = orderYear(placedAt, timeZone);
    const number = await this.orders.nextNumber(tx, scope, year);
    return { year, number, reference: orderReference(year, number) };
  }

  private async detail(tx: Executor, scope: TenantScope, row: OrderRow): Promise<OrderDetail> {
    // The composite foreign key guarantees the customer; a miss here is a bug.
    const customer = await this.orders.findCustomer(tx, scope, row.customerId);
    if (!customer) throw new Error(`order ${row.id} has no customer`);
    return toOrderDetail({
      order: row,
      items: await this.orders.items(tx, scope, row.id),
      customer,
      history: await this.orders.customerHistory(tx, scope, row.customerId, {
        before: row.placedAt,
        excludeId: row.id,
      }),
    });
  }
}
