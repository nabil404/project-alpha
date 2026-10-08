import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { DeliverySettings, SaveDeliverySettingsInput } from '@app/shared';

// The queries file, not the barrel: the catalog's editor reads this module back.
import { catalogKeys } from '@/features/catalog/queries';
import { apiFetch } from '@/lib/api';

import { settingsKeys } from './queries';

/** Settings > Delivery charges. The product editor and the order forms read it too. */
export const deliverySettingsQueryOptions = () =>
  queryOptions({
    queryKey: settingsKeys.delivery(),
    queryFn: () => apiFetch<DeliverySettings>('/settings/delivery'),
  });

export function useSaveDeliverySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDeliverySettingsInput) =>
      apiFetch<DeliverySettings>('/settings/delivery', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(settingsKeys.delivery(), saved);
      // Removing an area removes products' own charges for it.
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
  });
}
