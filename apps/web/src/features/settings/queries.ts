import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AccountPreferences,
  GeneralSettings,
  ShopLogo,
  UpdateAccountPreferences,
  UpdateGeneralSettings,
} from '@app/shared';

import { authKeys } from '@/features/auth';
import { apiFetch } from '@/lib/api';

/**
 * Settings > General, under /api/v1/settings/general. The same query feeds
 * every page's money and dates through ShopRegionProvider, so a save updates
 * them all at once.
 */
export const settingsKeys = {
  all: ['settings'] as const,
  general: () => [...settingsKeys.all, 'general'] as const,
  delivery: () => [...settingsKeys.all, 'delivery'] as const,
};

export const generalSettingsQueryOptions = () =>
  queryOptions({
    queryKey: settingsKeys.general(),
    queryFn: () => apiFetch<GeneralSettings>('/settings/general'),
  });

export function useUpdateGeneralSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateGeneralSettings) =>
      apiFetch<GeneralSettings>('/settings/general', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: async (saved, input) => {
      const before = queryClient.getQueryData<GeneralSettings>(settingsKeys.general());
      queryClient.setQueryData(settingsKeys.general(), saved);
      // A currency change rescales stored prices and delivery charges when the
      // decimals differ, so every cached amount (catalog, customers, delivery
      // charges) may be stale.
      if (input.currency !== undefined && before?.currency !== saved.currency) {
        await queryClient.invalidateQueries({
          predicate: ({ queryKey: [domain, section] }) =>
            !(domain === settingsKeys.all[0] && section === settingsKeys.general()[1]),
        });
      }
    },
  });
}

/** The logo lives on the settings response, so the cached settings take the new URL. */
function useSetLogo() {
  const queryClient = useQueryClient();
  return ({ logo }: ShopLogo) =>
    queryClient.setQueryData(settingsKeys.general(), (current) =>
      current ? { ...current, logo } : current,
    );
}

export function useUploadLogo() {
  const setLogo = useSetLogo();

  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return apiFetch<ShopLogo>('/settings/general/logo', { method: 'PUT', body });
    },
    onSuccess: setLogo,
  });
}

export function useRemoveLogo() {
  const setLogo = useSetLogo();

  return useMutation({
    mutationFn: () => apiFetch<ShopLogo>('/settings/general/logo', { method: 'DELETE' }),
    onSuccess: setLogo,
  });
}

/** The person's own language; it lives on the session's user. */
export function useUpdateAccountPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAccountPreferences) =>
      apiFetch<AccountPreferences>('/account/preferences', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.session() }),
  });
}
