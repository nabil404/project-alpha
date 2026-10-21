import { useCallback } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { importPostFilterSchema, listImportPostsQuerySchema } from '@app/shared';

import { ImportRunPage, importRunQueryOptions, type ImportRunSearch } from '@/features/imports';

const { shape } = listImportPostsQuerySchema;
const DEFAULTS: ImportRunSearch = { tab: 'needs_info', page: 1, limit: 10 };

/** The summary's tab and page, each absent at its default. */
function toSearch(input: Record<string, unknown>): Partial<ImportRunSearch> {
  const tab = importPostFilterSchema.safeParse(input.tab);
  const page = shape.page.safeParse(input.page);
  const limit = shape.limit.safeParse(input.limit);
  return {
    tab: tab.success && tab.data !== DEFAULTS.tab ? tab.data : undefined,
    page: page.success && page.data !== DEFAULTS.page ? page.data : undefined,
    limit: limit.success && limit.data !== DEFAULTS.limit ? limit.data : undefined,
  };
}

export const Route = createFileRoute('/_app/catalog/imports/$importId')({
  validateSearch: toSearch,
  loader: ({ context, params: { importId } }) =>
    context.queryClient.prefetchQuery(importRunQueryOptions(importId)),
  component: ImportRunRoute,
});

function ImportRunRoute() {
  const { importId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const onChange = useCallback(
    (change: Partial<ImportRunSearch>) =>
      void navigate({
        to: '.',
        search: (prev) => toSearch({ ...prev, ...change }),
        replace: 'limit' in change,
      }),
    [navigate],
  );

  return (
    <ImportRunPage
      key={importId}
      importId={importId}
      search={{
        tab: search.tab ?? DEFAULTS.tab,
        page: search.page ?? DEFAULTS.page,
        limit: search.limit ?? DEFAULTS.limit,
      }}
      onChange={onChange}
    />
  );
}
