import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  Category,
  CreateProduct,
  ListProductsQuery,
  Product,
  ProductCounts,
  ProductImage,
  ProductListResponse,
  SaveProduct,
} from '@app/shared';

import { apiFetch, apiUpload, type UploadOptions } from '@/lib/api';

/**
 * Products and categories, under /api/v1/products and /api/v1/categories.
 * The list and its counts sit apart from the product details, so a write can
 * refresh the list without refetching the product an edit page is holding.
 */
export const catalogKeys = {
  all: ['catalog'] as const,
  products: () => [...catalogKeys.all, 'products'] as const,
  product: (id: string) => [...catalogKeys.products(), 'detail', id] as const,
  productLists: () => [...catalogKeys.all, 'product-lists'] as const,
  productList: (query: ListProductsQuery) =>
    [...catalogKeys.productLists(), 'list', query] as const,
  productCounts: () => [...catalogKeys.productLists(), 'counts'] as const,
  categories: () => [...catalogKeys.all, 'categories'] as const,
};

/** Any product write moves its row, its sums, or which chip it counts under. */
const refreshLists = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: catalogKeys.productLists() });

function listSearch({ filter, q, categoryId, page, limit }: ListProductsQuery): string {
  const params = new URLSearchParams({ filter, page: String(page), limit: String(limit) });
  if (q) params.set('q', q);
  if (categoryId) params.set('categoryId', categoryId);
  return params.toString();
}

/** Keeps the page on screen while the next one loads, so paging and filtering don't flash empty. */
export function useProductList(query: ListProductsQuery) {
  return useQuery({
    queryKey: catalogKeys.productList(query),
    queryFn: () => apiFetch<ProductListResponse>(`/products?${listSearch(query)}`),
    placeholderData: keepPreviousData,
  });
}

export function useProductCounts() {
  return useQuery({
    queryKey: catalogKeys.productCounts(),
    queryFn: () => apiFetch<ProductCounts>('/products/counts'),
  });
}

const productPath = (id: string) => `/products/${encodeURIComponent(id)}`;

export const productQueryOptions = (id: string) =>
  queryOptions({
    queryKey: catalogKeys.product(id),
    queryFn: () => apiFetch<Product>(productPath(id)),
  });

export function useProduct(id: string) {
  return useQuery(productQueryOptions(id));
}

export const categoriesQueryOptions = () =>
  queryOptions({
    queryKey: catalogKeys.categories(),
    queryFn: () => apiFetch<Category[]>('/categories'),
  });

export function useCategories() {
  return useQuery(categoriesQueryOptions());
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProduct) =>
      apiFetch<Product>('/products', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (product) => {
      queryClient.setQueryData(catalogKeys.product(product.id), product);
      void refreshLists(queryClient);
    },
  });
}

/** The edit page's Save: the whole document, refused with PRODUCT_STALE if the product moved on. */
export function useSaveProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SaveProduct }) =>
      apiFetch<Product>(productPath(id), { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (product) => {
      queryClient.setQueryData(catalogKeys.product(product.id), product);
      void refreshLists(queryClient);
    },
  });
}

/**
 * Leaves the deleted product's cache entry alone: the page showing it is still
 * mounted and would refetch a 404. The caller drops it once it has navigated away.
 */
export function useDeleteProduct(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch<void>(productPath(id), { method: 'DELETE' }),
    onSuccess: () => refreshLists(queryClient),
  });
}

/**
 * One photo onto the end of the gallery. A photo upload doesn't change the
 * product's version, so the page's unsaved edits stay saveable; the refetch
 * only brings in the new photo (and the cover, if it was the first).
 */
export function useUploadProductImage(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, ...options }: { file: File } & UploadOptions) => {
      const body = new FormData();
      body.append('file', file);
      return apiUpload<ProductImage>(`${productPath(productId)}/images`, body, options);
    },
    onSettled: () => {
      void refreshLists(queryClient);
      return queryClient.invalidateQueries({ queryKey: catalogKeys.product(productId) });
    },
  });
}

/** Deleting the default photo makes the first remaining one the default. */
export function useDeleteProductImage(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (imageId: string) =>
      apiFetch<void>(`${productPath(productId)}/images/${encodeURIComponent(imageId)}`, {
        method: 'DELETE',
      }),
    onSettled: () => {
      void refreshLists(queryClient);
      return queryClient.invalidateQueries({ queryKey: catalogKeys.product(productId) });
    },
  });
}
