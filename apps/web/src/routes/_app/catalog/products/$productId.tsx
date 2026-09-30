import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  categoriesQueryOptions,
  ProductEditor,
  productQueryOptions,
  useProduct,
} from '@/features/catalog';
import { useErrorMessages } from '@/i18n/error-keys';

export const Route = createFileRoute('/_app/catalog/products/$productId')({
  loader: ({ context, params: { productId } }) =>
    Promise.all([
      context.queryClient.prefetchQuery(productQueryOptions(productId)),
      context.queryClient.prefetchQuery(categoriesQueryOptions()),
    ]),
  component: ProductPage,
});

function ProductPage() {
  const { productId } = Route.useParams();
  const { t } = useTranslation('catalog');
  const { forError } = useErrorMessages();
  const product = useProduct(productId);

  if (product.data) {
    // Keyed, so moving to another product starts its form afresh.
    return <ProductEditor key={productId} product={product.data} />;
  }

  if (product.isError) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-4">
        <ErrorBanner className="self-stretch">{forError(product.error)}</ErrorBanner>
        <Button asChild>
          <Link to="/catalog">{t('editor.backToCatalog')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div aria-busy className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="h-10 w-64 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-96 animate-pulse rounded-lg bg-surface-sunken" />
    </div>
  );
}
