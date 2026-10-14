import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdProduct, AdProductListResponse, UpdateAdProduct } from '@app/shared';

import { apiFetch } from '@/lib/api';

import { messengerKeys } from './queries';

export const adProductsQueryOptions = () =>
  queryOptions({
    queryKey: [...messengerKeys.all, 'ads'] as const,
    queryFn: () => apiFetch<AdProductListResponse>('/messenger/ads'),
  });

export function useAdProducts() {
  return useQuery(adProductsQueryOptions());
}

export interface MapAdProduct {
  id: string;
  /** The chosen product, or null for a normal chat. The name and status fill the row at once. */
  product: AdProduct['product'];
}

/**
 * Maps an ad to a product. The row takes the choice at once and gets its old
 * product back if the save fails; the list refetches once the last save settles.
 */
export function useMapAdProduct() {
  const queryClient = useQueryClient();
  const key = adProductsQueryOptions().queryKey;
  const mutationKey = [...key, 'map'] as const;

  return useMutation({
    mutationKey,
    mutationFn: ({ id, product }: MapAdProduct) => {
      const body: UpdateAdProduct = { productId: product?.id ?? null };
      return apiFetch<AdProduct>(`/messenger/ads/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onMutate: async ({ id, product }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<AdProductListResponse>(key);
      const previous = before?.data.find((ad) => ad.id === id)?.product ?? null;
      queryClient.setQueryData<AdProductListResponse>(key, (current) =>
        current
          ? { data: current.data.map((ad) => (ad.id === id ? { ...ad, product } : ad)) }
          : current,
      );
      return { previous };
    },
    onError: (_error, { id }, context) => {
      // Put back only this row; others may have moved since.
      queryClient.setQueryData<AdProductListResponse>(key, (current) =>
        current
          ? {
              data: current.data.map((ad) =>
                ad.id === id ? { ...ad, product: context?.previous ?? null } : ad,
              ),
            }
          : current,
      );
    },
    onSettled: async () => {
      if (queryClient.isMutating({ mutationKey }) === 1) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
