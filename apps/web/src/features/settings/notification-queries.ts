import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationSettings, UpdateNotificationSettings } from '@app/shared';

import { apiFetch } from '@/lib/api';

import { settingsKeys } from './queries';

/** The signed-in person's own switches for the active shop. */
export const notificationSettingsQueryOptions = () =>
  queryOptions({
    queryKey: settingsKeys.notifications(),
    queryFn: () => apiFetch<NotificationSettings>('/settings/notifications'),
  });

const updateKey = [...settingsKeys.notifications(), 'update'] as const;

/**
 * Saves one switch as soon as it flips. The cache takes the change at once
 * and gets the old value back if the save fails. Only the last of several
 * quick toggles refetches, so an earlier response cannot flip a switch back.
 */
export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  const key = settingsKeys.notifications();

  return useMutation({
    mutationKey: updateKey,
    mutationFn: (change: UpdateNotificationSettings) =>
      apiFetch<NotificationSettings>('/settings/notifications', {
        method: 'PATCH',
        body: JSON.stringify(change),
      }),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<NotificationSettings>(key);
      queryClient.setQueryData<NotificationSettings>(key, (current) =>
        current ? { ...current, ...change } : current,
      );
      return { before };
    },
    onError: (_error, change, context) => {
      // Put back only the switch this save changed; others may have moved since.
      const before = context?.before;
      if (!before) return;
      const restored = Object.fromEntries(
        Object.keys(change).map((name) => [name, before[name as keyof NotificationSettings]]),
      );
      queryClient.setQueryData<NotificationSettings>(key, (current) =>
        current ? { ...current, ...restored } : current,
      );
    },
    onSettled: async () => {
      if (queryClient.isMutating({ mutationKey: updateKey }) === 1) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
