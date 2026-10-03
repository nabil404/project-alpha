import { createFileRoute } from '@tanstack/react-router';

import { categoriesQueryOptions, CategoryList } from '@/features/catalog';

export const Route = createFileRoute('/_app/catalog/categories')({
  loader: ({ context }) => context.queryClient.prefetchQuery(categoriesQueryOptions()),
  component: CategoryList,
});
