import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AssistantSettingsView, UpdateAssistantSettings } from '@app/shared';

import { apiFetch } from '@/lib/api';

import { settingsKeys } from './queries';

/** How the assistant talks, with the languages it may default to. */
export const assistantSettingsQueryOptions = () =>
  queryOptions({
    queryKey: settingsKeys.assistant(),
    queryFn: () => apiFetch<AssistantSettingsView>('/settings/assistant'),
  });

export function useUpdateAssistantSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAssistantSettings) =>
      apiFetch<AssistantSettingsView>('/settings/assistant', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (saved) => queryClient.setQueryData(settingsKeys.assistant(), saved),
  });
}
