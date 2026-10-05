import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  CreateOrder,
  CustomerDetail,
  CustomerListResponse,
  ListOrdersQuery,
  OrderDetail,
  OrderEvent,
  OrderListResponse,
  OrderSummary,
  OrderSummaryQuery,
  ReplaceOrderItems,
  UpdateOrder,
  UpdateOrderStatus,
} from '@app/shared';

import { apiFetch } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * The shop's orders, under /api/v1/orders. The list and its summary sit
 * apart from each order, so a change refreshes the list without refetching
 * the order the seller is looking at, which the change's answer replaces.
 */
export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'lists'] as const,
  list: (query: ListOrdersQuery) => [...orderKeys.lists(), 'list', query] as const,
  summary: (query: OrderSummaryQuery) => [...orderKeys.lists(), 'summary', query] as const,
  order: (id: string) => [...orderKeys.all, 'order', id] as const,
  detail: (id: string) => [...orderKeys.order(id), 'detail'] as const,
  activity: (id: string) => [...orderKeys.order(id), 'activity'] as const,
  customerSearch: (q: string) => [...orderKeys.all, 'customer-search', q] as const,
  customer: (id: string) => [...orderKeys.all, 'customer', id] as const,
};

function searchParams(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

/** Keeps the page on screen while the next one loads, so paging and filtering don't flash empty. */
export function useOrderList(query: ListOrdersQuery) {
  return useQuery({
    queryKey: orderKeys.list(query),
    queryFn: () => apiFetch<OrderListResponse>(`/orders?${searchParams(query)}`),
    placeholderData: keepPreviousData,
  });
}

/** The cards and the tab counts, which follow the list's search and dates. */
export function useOrderSummary(query: OrderSummaryQuery = {}) {
  return useQuery({
    queryKey: orderKeys.summary(query),
    queryFn: () => apiFetch<OrderSummary>(`/orders/summary?${searchParams(query)}`),
    placeholderData: keepPreviousData,
  });
}

const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;

export const orderQueryOptions = (id: string) =>
  queryOptions({
    queryKey: orderKeys.detail(id),
    queryFn: () => apiFetch<OrderDetail>(orderPath(id)),
  });

export function useOrder(id: string) {
  return useQuery(orderQueryOptions(id));
}

export const orderActivityQueryOptions = (id: string) =>
  queryOptions({
    queryKey: orderKeys.activity(id),
    queryFn: () => apiFetch<OrderEvent[]>(`${orderPath(id)}/activity`),
  });

export function useOrderActivity(id: string) {
  return useQuery(orderActivityQueryOptions(id));
}

/**
 * After any order change: the order as the API answered it, then everything
 * the change can move. Stock lives on the catalog's products, and a
 * customer's figures on the Customers pages.
 */
function onOrderChanged(queryClient: QueryClient, order: OrderDetail) {
  queryClient.setQueryData(orderKeys.detail(order.id), order);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: orderKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: orderKeys.activity(order.id) }),
    queryClient.invalidateQueries({ queryKey: ['catalog'] }),
    queryClient.invalidateQueries({ queryKey: ['customers'] }),
  ]);
}

/**
 * A conflict means the order, or the stock behind it, is not what this page
 * read: someone else changed it. Fetch it again, so the seller sees what
 * changed and can redo theirs on top.
 */
function onOrderError(queryClient: QueryClient, id: string, error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    void queryClient.invalidateQueries({ queryKey: orderKeys.order(id) });
  }
}

function useOrderMutation<Input>(id: string, request: (input: Input) => Promise<OrderDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (order) => onOrderChanged(queryClient, order),
    onError: (error) => onOrderError(queryClient, id, error),
  });
}

export function useChangeOrderStatus(id: string) {
  return useOrderMutation(id, (input: UpdateOrderStatus) =>
    apiFetch<OrderDetail>(`${orderPath(id)}/status`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export function useReplaceOrderItems(id: string) {
  return useOrderMutation(id, (input: ReplaceOrderItems) =>
    apiFetch<OrderDetail>(`${orderPath(id)}/items`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  );
}

export function useUpdateOrder(id: string) {
  return useOrderMutation(id, (input: UpdateOrder) =>
    apiFetch<OrderDetail>(orderPath(id), { method: 'PATCH', body: JSON.stringify(input) }),
  );
}

/**
 * The key is made once per dialog, so a retry after a dropped response
 * returns the order the first attempt created instead of adding a second.
 */
export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreateOrder; idempotencyKey: string }) =>
      apiFetch<OrderDetail>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(input),
      }),
    onSuccess: (order) => onOrderChanged(queryClient, order),
  });
}

/**
 * Customers to add an order for, by name or phone. Read here rather than
 * through the Customers feature, which imports this one.
 */
export function useCustomerSearch(q: string) {
  return useQuery({
    queryKey: orderKeys.customerSearch(q),
    queryFn: () =>
      apiFetch<CustomerListResponse>(
        `/customers?${searchParams({ q: q || undefined, sort: 'last_order', pageSize: 10 })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

/** The chosen customer's details on file, which a new order defaults to. */
export function useOrderCustomer(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.customer(id ?? ''),
    queryFn: () => apiFetch<CustomerDetail>(`/customers/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
  });
}
