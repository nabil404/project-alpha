import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateCustomerNote,
  CustomerDetail,
  CustomerListResponse,
  CustomerNote,
  CustomerOrderPage,
  CustomerSummary,
  ListCustomerOrdersQuery,
  ListCustomersQuery,
  UpdateCustomer,
} from '@app/shared';

import { apiFetch } from '@/lib/api';

/**
 * The shop's customers, under /api/v1/customers. The list and its summary sit
 * apart from each customer's details, so a contact edit refreshes the list
 * without refetching the orders and notes on the page being edited.
 */
export const customerKeys = {
  all: ['customers'] as const,
  lists: () => [...customerKeys.all, 'lists'] as const,
  list: (query: ListCustomersQuery) => [...customerKeys.lists(), 'list', query] as const,
  summary: () => [...customerKeys.lists(), 'summary'] as const,
  customer: (id: string) => [...customerKeys.all, 'customer', id] as const,
  detail: (id: string) => [...customerKeys.customer(id), 'detail'] as const,
  orders: (id: string, query: ListCustomerOrdersQuery) =>
    [...customerKeys.customer(id), 'orders', query] as const,
  notes: (id: string) => [...customerKeys.customer(id), 'notes'] as const,
};

function listSearch({ filter, q, sort, direction, page, pageSize }: ListCustomersQuery): string {
  const params = new URLSearchParams({
    filter,
    sort,
    direction,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (q) params.set('q', q);
  return params.toString();
}

/** Keeps the page on screen while the next one loads, so paging and sorting don't flash empty. */
export function useCustomerList(query: ListCustomersQuery) {
  return useQuery({
    queryKey: customerKeys.list(query),
    queryFn: () => apiFetch<CustomerListResponse>(`/customers?${listSearch(query)}`),
    placeholderData: keepPreviousData,
  });
}

export function useCustomerSummary() {
  return useQuery({
    queryKey: customerKeys.summary(),
    queryFn: () => apiFetch<CustomerSummary>('/customers/summary'),
  });
}

const customerPath = (id: string) => `/customers/${encodeURIComponent(id)}`;

export const customerQueryOptions = (id: string) =>
  queryOptions({
    queryKey: customerKeys.detail(id),
    queryFn: () => apiFetch<CustomerDetail>(customerPath(id)),
  });

export function useCustomer(id: string) {
  return useQuery(customerQueryOptions(id));
}

export const customerOrdersQueryOptions = (id: string, query: ListCustomerOrdersQuery) =>
  queryOptions({
    queryKey: customerKeys.orders(id, query),
    queryFn: () =>
      apiFetch<CustomerOrderPage>(
        `${customerPath(id)}/orders?${new URLSearchParams({
          page: String(query.page),
          pageSize: String(query.pageSize),
        })}`,
      ),
    placeholderData: keepPreviousData,
  });

export function useCustomerOrders(id: string, query: ListCustomerOrdersQuery) {
  return useQuery(customerOrdersQueryOptions(id, query));
}

export const customerNotesQueryOptions = (id: string) =>
  queryOptions({
    queryKey: customerKeys.notes(id),
    queryFn: () => apiFetch<CustomerNote[]>(`${customerPath(id)}/notes`),
  });

export function useCustomerNotes(id: string) {
  return useQuery(customerNotesQueryOptions(id));
}

/** The answer is the customer as saved; the list rows show the same phone and area. */
export function useUpdateCustomer(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateCustomer) =>
      apiFetch<CustomerDetail>(customerPath(id), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (customer) => {
      queryClient.setQueryData(customerKeys.detail(id), customer);
      return queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

export function useCreateCustomerNote(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCustomerNote) =>
      apiFetch<CustomerNote>(`${customerPath(id)}/notes`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customerKeys.notes(id) }),
  });
}
