import { createFileRoute } from '@tanstack/react-router';

import { categoriesQueryOptions, ProductEditor } from '@/features/catalog';

export const Route = createFileRoute('/_app/catalog/products/new')({
  loader: ({ context }) => context.queryClient.prefetchQuery(categoriesQueryOptions()),
  component: NewProductPage,
});

function NewProductPage() {
  return <ProductEditor />;
}
