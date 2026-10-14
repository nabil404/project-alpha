import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdProduct } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Select, type SelectOption } from '@/components/ui/select';
import { useProductList } from '@/features/catalog';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';

import { useAdProducts, useMapAdProduct } from '../ads-queries';

const sectionClass = 'flex flex-col rounded-lg border border-border bg-surface shadow-card';
const rowGrid =
  'sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_4rem_minmax(0,16rem)] sm:items-start sm:gap-4';

/** Ads that opened a chat, and the product each one sells. */
export function AdProductsCard() {
  const { t } = useTranslation(['settings', 'common']);
  const { forError } = useErrorMessages();
  const { formatDate } = useFormatters();
  const toast = useToast();
  const ads = useAdProducts();
  const map = useMapAdProduct();
  // Archived products are left out; a draft is listed so it can be mapped ahead of publishing.
  const products = useProductList({ filter: 'all', page: 1, limit: 100 });

  const catalog = useMemo(
    () => (products.data?.data ?? []).map(({ id, name, status }) => ({ id, name, status })),
    [products.data],
  );

  if (ads.isPending) {
    return <div aria-busy className={`${sectionClass} h-48`} />;
  }
  if (ads.isError) {
    return <ErrorBanner>{forError(ads.error)}</ErrorBanner>;
  }

  const rows = ads.data.data;
  const needing = rows.filter((ad) => ad.product === null).length;

  const optionsFor = (ad: AdProduct): SelectOption[] => {
    const options: SelectOption[] = [
      { value: '', label: t('messenger.ads.noProduct') },
      ...catalog.map((product) => ({
        value: product.id,
        label:
          product.status === 'draft'
            ? t('messenger.ads.draftOption', { name: product.name })
            : product.name,
      })),
    ];
    // A product archived since it was mapped is not in the list, but the row must still name it.
    if (ad.product && !catalog.some((product) => product.id === ad.product?.id)) {
      options.push({
        value: ad.product.id,
        label: t('messenger.ads.archivedOption', { name: ad.product.name }),
      });
    }
    return options;
  };

  const choose = (ad: AdProduct, productId: string) => {
    if (productId === (ad.product?.id ?? '')) return;
    const picked = catalog.find((product) => product.id === productId);
    map.mutate(
      { id: ad.id, product: picked ?? null },
      { onSuccess: () => toast.success(t('messenger.ads.saved')) },
    );
  };

  const picker = (ad: AdProduct) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Select
        aria-label={t('messenger.ads.productFor', { adId: ad.adId })}
        value={ad.product?.id ?? ''}
        onValueChange={(productId) => choose(ad, productId)}
        options={optionsFor(ad)}
        disabled={products.isPending}
      />
      {ad.product?.status === 'draft' && (
        <p className="text-small text-ink-muted">
          <span className="mr-1.5 inline-flex h-5 items-center rounded-full bg-warning-soft px-2 text-label text-warning">
            {t('common:status.product.draft')}
          </span>
          {t('messenger.ads.draftHint')}
        </p>
      )}
      {ad.product?.status === 'archived' && (
        <p className="text-small text-ink-muted">{t('messenger.ads.archivedHint')}</p>
      )}
    </div>
  );

  return (
    <section className={sectionClass}>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-heading">{t('messenger.ads.title')}</h2>
            <p className="text-body text-ink-muted">{t('messenger.ads.description')}</p>
          </div>
          {needing > 0 && (
            <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-warning-soft px-2.5 text-label whitespace-nowrap text-warning">
              {t('messenger.ads.needsProduct', { count: needing })}
            </span>
          )}
        </div>

        {products.isError && <ErrorBanner>{t('messenger.ads.loadFailed')}</ErrorBanner>}
        {map.error && <ErrorBanner>{forError(map.error)}</ErrorBanner>}

        {rows.length === 0 ? (
          <p className="rounded-md bg-surface-sunken p-4 text-body text-ink-muted">
            {t('messenger.ads.empty')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              aria-hidden
              className={`hidden px-3 text-small font-medium text-ink-muted ${rowGrid}`}
            >
              <span>{t('messenger.ads.adId')}</span>
              <span>{t('messenger.ads.firstSeen')}</span>
              <span>{t('messenger.ads.chats')}</span>
              <span>{t('messenger.ads.product')}</span>
            </div>
            <ul className="flex flex-col gap-3 sm:gap-2">
              {rows.map((ad) => (
                <li
                  key={ad.id}
                  className={`flex flex-col gap-2 rounded-md border border-border p-3 sm:border-0 sm:p-0 sm:px-3 ${rowGrid}`}
                >
                  <span className="min-w-0 font-mono text-small break-all sm:pt-2.5">
                    {ad.adId}
                  </span>
                  <span className="text-small text-ink-muted sm:hidden">
                    {t('messenger.ads.chatsSince', {
                      count: ad.chatCount,
                      date: formatDate(ad.firstSeenAt, 'dayMonth'),
                    })}
                  </span>
                  <span className="hidden text-small text-ink-muted sm:block sm:pt-2.5">
                    {formatDate(ad.firstSeenAt, 'dayMonth')}
                  </span>
                  <span className="hidden text-small sm:block sm:pt-2.5">{ad.chatCount}</span>
                  {picker(ad)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-small text-ink-muted">{t('messenger.ads.hint')}</p>
      </div>
    </section>
  );
}
