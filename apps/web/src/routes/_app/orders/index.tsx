import { useCallback } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  listOrdersQuerySchema,
  orderFilterSchema,
  orderSortSchema,
  sortDirectionSchema,
  type OrderFilter,
  type OrderSort,
  type SortDirection,
} from '@app/shared';

import {
  DAY_PATTERN,
  OrderList,
  orderRanges,
  type OrderListChange,
  type OrderListView,
  type OrderRange,
} from '@/features/orders';

/**
 * The list's view in the URL, each part absent at its default so the plain
 * page keeps a plain URL. Custom dates are the shop's calendar days
 * ("2026-10-05"); the list turns them into instants.
 */
interface OrdersSearch {
  status?: Exclude<OrderFilter, 'all'>;
  q?: string;
  range?: Exclude<OrderRange, 'all'>;
  from?: string;
  to?: string;
  sort?: OrderSort;
  direction?: SortDirection;
  page?: number;
  pageSize?: number;
}

const DEFAULTS = listOrdersQuerySchema.parse({});
const { shape } = listOrdersQuerySchema;

/** One bad parameter resets only itself, not the whole search. */
function toSearch(input: Record<string, unknown>): OrdersSearch {
  const parsed = <T,>(result: { success: true; data: T } | { success: false }) =>
    result.success ? result.data : undefined;
  const absentAt = <T,>(value: T | undefined, fallback: T) =>
    value === fallback ? undefined : value;
  const day = (value: unknown) =>
    typeof value === 'string' && DAY_PATTERN.test(value) ? value : undefined;
  const status = parsed(orderFilterSchema.safeParse(input.status));
  const range = orderRanges.find((option) => option === input.range);
  const custom = range === 'custom';
  return {
    status: status === 'all' ? undefined : status,
    // A hand-typed `?q=481` arrives as a number: the router parses search values as JSON.
    q: parsed(shape.q.safeParse(typeof input.q === 'number' ? String(input.q) : input.q)),
    range: range === 'all' ? undefined : range,
    from: custom ? day(input.from) : undefined,
    to: custom ? day(input.to) : undefined,
    sort: absentAt(parsed(orderSortSchema.safeParse(input.sort)), DEFAULTS.sort),
    direction: absentAt(parsed(sortDirectionSchema.safeParse(input.direction)), DEFAULTS.direction),
    page: absentAt(parsed(shape.page.safeParse(input.page)), DEFAULTS.page),
    pageSize: absentAt(parsed(shape.pageSize.safeParse(input.pageSize)), DEFAULTS.pageSize),
  };
}

export const Route = createFileRoute('/_app/orders/')({
  validateSearch: toSearch,
  component: OrdersPage,
});

function OrdersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  // Field by field: the search carries its absent parts as explicit undefined,
  // which a spread would copy over the defaults.
  const view: OrderListView = {
    status: search.status ?? DEFAULTS.status,
    q: search.q,
    range: search.range ?? 'all',
    from: search.from,
    to: search.to,
    sort: search.sort ?? DEFAULTS.sort,
    direction: search.direction ?? DEFAULTS.direction,
    page: search.page ?? DEFAULTS.page,
    pageSize: search.pageSize ?? DEFAULTS.pageSize,
  };

  // Anything but the page itself sends the seller back to the first page.
  const onChange = useCallback(
    (change: OrderListChange) =>
      void navigate({
        to: '.',
        search: (prev) =>
          toSearch({ ...prev, ...change, page: 'page' in change ? change.page : undefined }),
        replace: !('page' in change),
      }),
    [navigate],
  );

  return <OrderList view={view} onChange={onChange} />;
}
