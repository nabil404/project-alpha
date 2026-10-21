import { useCallback } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { listImportsQuerySchema, type ListImportsQuery } from '@app/shared';

import { ImportList } from '@/features/imports';

const DEFAULTS = listImportsQuerySchema.parse({});
const { shape } = listImportsQuerySchema;

interface ImportsSearch {
  page?: number;
  limit?: number;
}

/** Each part absent at its default; one bad parameter resets only itself. */
function toSearch(input: Record<string, unknown>): ImportsSearch {
  const page = shape.page.safeParse(input.page);
  const limit = shape.limit.safeParse(input.limit);
  return {
    page: page.success && page.data !== DEFAULTS.page ? page.data : undefined,
    limit: limit.success && limit.data !== DEFAULTS.limit ? limit.data : undefined,
  };
}

export const Route = createFileRoute('/_app/catalog/imports/')({
  validateSearch: toSearch,
  component: ImportsPage,
});

function ImportsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const query: ListImportsQuery = {
    page: search.page ?? DEFAULTS.page,
    limit: search.limit ?? DEFAULTS.limit,
  };

  const onChange = useCallback(
    (change: Partial<ListImportsQuery>) =>
      void navigate({ to: '.', search: (prev) => toSearch({ ...prev, ...change }) }),
    [navigate],
  );

  return <ImportList query={query} onChange={onChange} />;
}
