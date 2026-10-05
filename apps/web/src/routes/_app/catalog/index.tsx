import { useCallback } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  listProductsQuerySchema,
  type ListProductsQuery,
  type ProductListFilter,
} from '@app/shared';

import { ProductList, type ProductListChange } from '@/features/catalog';

/**
 * The list's query in the URL, each part absent at its default so the plain
 * page keeps a plain URL. The filter is `show`, not `filter`: the router
 * merges every route's search, and Conversations already has a `filter`.
 */
interface CatalogSearch {
  show?: Exclude<ProductListFilter, 'all'>;
  q?: string;
  categoryId?: string;
  page?: number;
  limit?: number;
}

const DEFAULTS = listProductsQuerySchema.parse({});
const { shape } = listProductsQuerySchema;

/** One bad parameter resets only itself, not the whole search. */
function toSearch(input: Record<string, unknown>): CatalogSearch {
  const parsed = <T,>(result: { success: true; data: T } | { success: false }) =>
    result.success ? result.data : undefined;
  const show = parsed(shape.filter.safeParse(input.show));
  const page = parsed(shape.page.safeParse(input.page));
  const limit = parsed(shape.limit.safeParse(input.limit));
  return {
    show: show === 'all' ? undefined : show,
    // A hand-typed `?q=481` arrives as a number: the router parses search values as JSON.
    q: parsed(shape.q.safeParse(typeof input.q === 'number' ? String(input.q) : input.q)),
    categoryId: parsed(shape.categoryId.safeParse(input.categoryId)),
    page: page === DEFAULTS.page ? undefined : page,
    limit: limit === DEFAULTS.limit ? undefined : limit,
  };
}

export const Route = createFileRoute('/_app/catalog/')({
  validateSearch: toSearch,
  component: CatalogPage,
});

function CatalogPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  // Field by field: the search carries its absent parts as explicit undefined,
  // which a spread would copy over the defaults.
  const query: ListProductsQuery = {
    filter: search.show ?? DEFAULTS.filter,
    q: search.q,
    categoryId: search.categoryId,
    page: search.page ?? DEFAULTS.page,
    limit: search.limit ?? DEFAULTS.limit,
  };

  // Anything but the page itself sends the seller back to the first page.
  const onChange = useCallback(
    ({ filter, ...change }: ProductListChange) =>
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

  return <ProductList query={query} onChange={onChange} />;
}
