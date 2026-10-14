import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProductPost,
  PagePostListResponse,
  ProductPost,
  ProductPostListResponse,
  UpdateProductPost,
} from '@app/shared';

import { apiFetch } from '@/lib/api';
// The queries file, not the messenger barrel, which reaches back into the catalog.
import { messengerKeys } from '@/features/messenger/queries';

import { catalogKeys } from './queries';

/** A product's linked and suggested Facebook posts, under /products/:id/posts. */
export const productPostsQueryOptions = (productId: string) =>
  queryOptions({
    queryKey: [...catalogKeys.product(productId), 'posts'] as const,
    queryFn: () =>
      apiFetch<ProductPostListResponse>(`/products/${encodeURIComponent(productId)}/posts`),
  });

export function useProductPosts(productId: string) {
  return useQuery(productPostsQueryOptions(productId));
}

/** The connected Page's recent posts, for the picker; fetched only while it is open. */
export const pagePostsQueryOptions = () =>
  queryOptions({
    queryKey: [...messengerKeys.all, 'page-posts'] as const,
    queryFn: () => apiFetch<PagePostListResponse>('/messenger/page-posts'),
    retry: false,
  });

export function usePagePosts(enabled: boolean) {
  return useQuery({ ...pagePostsQueryOptions(), enabled });
}

/** Every post write moves this product's list and the picker's "linked to" labels. */
function useRefresh(productId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: productPostsQueryOptions(productId).queryKey }),
      queryClient.invalidateQueries({ queryKey: pagePostsQueryOptions().queryKey }),
    ]);
}

export function useLinkProductPost(productId: string) {
  const refresh = useRefresh(productId);
  return useMutation({
    mutationFn: (body: CreateProductPost) =>
      apiFetch<ProductPost>(`/products/${encodeURIComponent(productId)}/posts`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: refresh,
  });
}

export function useAcceptProductPost(productId: string) {
  const refresh = useRefresh(productId);
  return useMutation({
    mutationFn: (id: string) => {
      const body: UpdateProductPost = { status: 'linked' };
      return apiFetch<ProductPost>(
        `/products/${encodeURIComponent(productId)}/posts/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
    },
    onSuccess: refresh,
  });
}

export function useRemoveProductPost(productId: string) {
  const refresh = useRefresh(productId);
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/products/${encodeURIComponent(productId)}/posts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: refresh,
  });
}
