import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category, CreateProduct, Product, ProductImage, SaveProduct } from '@app/shared';

import { apiFetch, apiUpload, type UploadOptions } from '@/lib/api';

/**
 * Products and categories, under /api/v1/products and /api/v1/categories.
 * There is no products list route yet, so nothing here lists products.
 */
export const catalogKeys = {
  all: ['catalog'] as const,
  products: () => [...catalogKeys.all, 'products'] as const,
  product: (id: string) => [...catalogKeys.products(), 'detail', id] as const,
  categories: () => [...catalogKeys.all, 'categories'] as const,
};

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
    onSuccess: (product) => queryClient.setQueryData(catalogKeys.product(product.id), product),
  });
}

/** The edit page's Save: the whole document, refused with PRODUCT_STALE if the product moved on. */
export function useSaveProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SaveProduct }) =>
      apiFetch<Product>(productPath(id), { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (product) => queryClient.setQueryData(catalogKeys.product(product.id), product),
  });
}

/**
 * Leaves the deleted product's cache entry alone: the page showing it is still
 * mounted and would refetch a 404. The caller drops it once it has navigated away.
 */
export function useDeleteProduct(id: string) {
  return useMutation({
    mutationFn: () => apiFetch<void>(productPath(id), { method: 'DELETE' }),
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: catalogKeys.product(productId) }),
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: catalogKeys.product(productId) }),
  });
}
