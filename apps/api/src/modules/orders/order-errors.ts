import type { OrderStatus } from '@app/shared';
import { CodedConflictException, CodedNotFoundException } from '../../common/errors/index';

export const orderNotFound = (id: string) =>
  new CodedNotFoundException('ORDER_NOT_FOUND', 'Order not found', { id });

/** The order changed after the page read it; applying this would overwrite that change. */
export const orderStale = (id: string) =>
  new CodedConflictException('ORDER_STALE', 'The order changed since it was read', { id });

export const orderInvalidTransition = (from: OrderStatus, to: OrderStatus) =>
  new CodedConflictException(
    'ORDER_INVALID_TRANSITION',
    `An order cannot move from ${from} to ${to}`,
    { from, to },
  );

/** The order is past the point where this part of it can change. */
export const orderNotEditable = (status: OrderStatus) =>
  new CodedConflictException('ORDER_NOT_EDITABLE', 'The order can no longer be changed', {
    status,
  });

export const orderInsufficientStock = (variant: { id: string; name: string; available: number }) =>
  new CodedConflictException('ORDER_INSUFFICIENT_STOCK', 'Not enough stock for this order', {
    variantId: variant.id,
    name: variant.name,
    available: variant.available,
  });
