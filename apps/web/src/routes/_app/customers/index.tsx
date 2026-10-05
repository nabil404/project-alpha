import { useCallback } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  listCustomersQuerySchema,
  type CustomerFilter,
  type CustomerSort,
  type ListCustomersQuery,
  type SortDirection,
} from '@app/shared';

import { CustomerList, type CustomerListChange } from '@/features/customers';

/**
 * The list's query in the URL, each part absent at its default so the plain
 * page keeps a plain URL. The filter is `show`, not `filter`, as on the
 * Products page: the router merges every route's search, and Conversations
 * already has a `filter`.
 */
interface CustomersSearch {
  show?: Exclude<CustomerFilter, 'all'>;
  q?: string;
  sort?: CustomerSort;
  direction?: SortDirection;
  page?: number;
  pageSize?: number;
}

const DEFAULTS = listCustomersQuerySchema.parse({});
const { shape } = listCustomersQuerySchema;

/** One bad parameter resets only itself, not the whole search. */
function toSearch(input: Record<string, unknown>): CustomersSearch {
  const parsed = <T,>(result: { success: true; data: T } | { success: false }) =>
    result.success ? result.data : undefined;
  const absentAt = <T,>(value: T | undefined, fallback: T) =>
    value === fallback ? undefined : value;
  const show = parsed(shape.filter.safeParse(input.show));
  return {
    show: show === 'all' ? undefined : show,
    // A hand-typed `?q=481` arrives as a number: the router parses search values as JSON.
    q: parsed(shape.q.safeParse(typeof input.q === 'number' ? String(input.q) : input.q)),
    sort: absentAt(parsed(shape.sort.safeParse(input.sort)), DEFAULTS.sort),
    direction: absentAt(parsed(shape.direction.safeParse(input.direction)), DEFAULTS.direction),
    page: absentAt(parsed(shape.page.safeParse(input.page)), DEFAULTS.page),
    pageSize: absentAt(parsed(shape.pageSize.safeParse(input.pageSize)), DEFAULTS.pageSize),
  };
}

export const Route = createFileRoute('/_app/customers/')({
  validateSearch: toSearch,
  component: CustomersPage,
});

function CustomersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  // Field by field: the search carries its absent parts as explicit undefined,
  // which a spread would copy over the defaults.
  const query: ListCustomersQuery = {
    filter: search.show ?? DEFAULTS.filter,
    q: search.q,
    sort: search.sort ?? DEFAULTS.sort,
    direction: search.direction ?? DEFAULTS.direction,
    page: search.page ?? DEFAULTS.page,
    pageSize: search.pageSize ?? DEFAULTS.pageSize,
  };

  // Anything but the page itself sends the seller back to the first page.
  const onChange = useCallback(
    ({ filter, ...change }: CustomerListChange) =>
      void navigate({
        to: '.',
        search: (prev) =>
          toSearch({
            ...prev,
            ...change,
            ...(filter === undefined ? {} : { show: filter }),
            page: 'page' in change ? change.page : undefined,
          }),
        replace: !('page' in change),
      }),
    [navigate],
  );

  return <CustomerList query={query} onChange={onChange} />;
}
