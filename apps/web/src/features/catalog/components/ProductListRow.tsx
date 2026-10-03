import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, CircleAlert, ImageIcon, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { stockLevelOf, type Product, type ProductListItem, type StockLevel } from '@app/shared';

import { Button } from '@/components/ui/button';
import { useStatusLabels } from '@/i18n/status-keys';
import { statusToneDotClasses, stockLevelTones } from '@/i18n/status-tones';
import { SHOP_CURRENCY } from '@/lib/currency';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import { productQueryOptions } from '../queries';
import { ProductStatusBadge } from './ProductStatusBadge';
import { productColumns as columns } from './product-table-columns';

/** Variants shown on expanding, and placeholder rows while they load; the rest wait behind "Show more". */
const VARIANT_PREVIEW = 5;

const cell = 'px-4 py-3 align-middle';
const variantCell = 'px-4 py-2 align-middle';
/** Indents a variant's name under its product's, past the expander and the product photo. */
const variantIndent = 'pl-[3.75rem]';

/**
 * One product, and its variants under it once expanded. The list only sums
 * variants up, so expanding reads the product itself, the same read the edit
 * page makes: a product opened here opens there without waiting. A product
 * with a single variant has nothing to expand; that variant is the row.
 */
export function ProductListRow({
  item,
  categoryNames,
}: {
  item: ProductListItem;
  categoryNames: Map<string, string>;
}) {
  const { t } = useTranslation('catalog');
  const { formatAmount } = useFormatters();
  const [expanded, setExpanded] = useState(false);
  const single = item.variant;
  const detail = useQuery({ ...productQueryOptions(item.id), enabled: expanded && !single });
  const loading = expanded && detail.isPending;
  const [firstCategory, ...otherCategories] = item.categoryIds.flatMap((id) => {
    const name = categoryNames.get(id);
    return name ? [name] : [];
  });

  const price =
    item.priceMin === item.priceMax
      ? formatAmount(item.priceMin, SHOP_CURRENCY)
      : t('list.priceRange', {
          min: formatAmount(item.priceMin, SHOP_CURRENCY),
          max: formatAmount(item.priceMax, SHOP_CURRENCY),
        });
  const notes =
    single || item.stock === 0
      ? []
      : [
          item.lowVariantCount > 0 && t('list.stockNote.low', { n: item.lowVariantCount }),
          item.outVariantCount > 0 && t('list.stockNote.out', { n: item.outVariantCount }),
        ].filter((note) => note !== false);

  return (
    <>
      <tr className="border-t border-border animate-in fade-in-0 duration-200">
        <td className="w-12 py-3 pr-0 pl-4 align-middle">
          {!single && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={expanded}
              aria-label={t(expanded ? 'list.toggle.hide' : 'list.toggle.show', {
                name: item.name,
              })}
              onClick={() => setExpanded((open) => !open)}
              className="text-ink-muted"
            >
              {loading ? (
                <LoaderCircle aria-hidden strokeWidth={1.5} className="animate-spin" />
              ) : expanded ? (
                <ChevronDown aria-hidden strokeWidth={1.5} />
              ) : (
                <ChevronRight aria-hidden strokeWidth={1.5} />
              )}
            </Button>
          )}
        </td>
        <td className={cn(cell, 'pl-2')}>
          <Link
            to="/catalog/products/$productId"
            params={{ productId: item.id }}
            className="flex min-w-0 items-center gap-3 rounded-sm text-ink"
          >
            <Thumbnail url={single ? single.thumbnailUrl : item.coverThumbnailUrl} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body font-medium">{item.name}</span>
              {single && (
                <span className="flex items-center gap-1.5 text-small text-ink-muted">
                  {single.name && (
                    <>
                      <span>{single.name}</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
                  <span className="font-mono text-code">{single.sku}</span>
                </span>
              )}
            </span>
          </Link>
        </td>
        <td className={cn(cell, columns.category.cell, 'text-body text-ink-muted')}>
          {firstCategory && (
            <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
              <span className="truncate" title={firstCategory}>
                {firstCategory}
              </span>
              {otherCategories.length > 0 && (
                <span
                  title={t('list.moreCategories', { list: otherCategories.join(', ') })}
                  className="inline-flex h-5.5 shrink-0 items-center rounded-full bg-surface-sunken px-2 text-label text-ink-muted"
                >
                  +{otherCategories.length}
                  <span className="sr-only">
                    {t('list.moreCategories', { list: otherCategories.join(', ') })}
                  </span>
                </span>
              )}
            </span>
          )}
        </td>
        <td className={cn(cell, columns.variants.cell, 'text-body tabular-nums')}>
          {item.variantCount}
        </td>
        <td
          className={cn(cell, columns.options.cell, 'truncate text-body')}
          title={item.optionNames.join(', ')}
        >
          {item.optionNames.length > 0 ? (
            item.optionNames.join(', ')
          ) : (
            <>
              <span aria-hidden className="text-ink-muted">
                —
              </span>
              <span className="sr-only">{t('list.noOptions')}</span>
            </>
          )}
        </td>
        <td className={cn(cell, 'text-right text-body whitespace-nowrap tabular-nums')}>{price}</td>
        <td className={cn(cell, 'text-right')}>
          <StockFigure stock={item.stock} level={item.stockLevel} notes={notes} />
        </td>
        <td className={cn(cell, columns.status.cell)}>
          <ProductStatusBadge status={item.status} />
        </td>
      </tr>

      {expanded && !single && (
        <VariantRows
          productName={item.name}
          variantCount={item.variantCount}
          detail={detail}
          onRetry={() => void detail.refetch()}
        />
      )}
    </>
  );
}

function VariantRows({
  productName,
  variantCount,
  detail,
  onRetry,
}: {
  productName: string;
  variantCount: number;
  detail: { data: Product | undefined; isError: boolean };
  onRetry: () => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  const { formatAmount } = useFormatters();
  const [showAll, setShowAll] = useState(false);
  const rowClass =
    'border-t border-dashed border-border bg-bg/40 shadow-[inset_3px_0_0_var(--color-border)]';

  if (detail.data) {
    const product = detail.data;
    const thumbnails = new Map(product.images.map((image) => [image.id, image.thumbnailUrl]));
    const cover = product.coverImageId ? (thumbnails.get(product.coverImageId) ?? null) : null;
    const shown = showAll ? product.variants : product.variants.slice(0, VARIANT_PREVIEW);
    const hidden = product.variants.length - shown.length;

    return (
      <>
        {shown.map((variant) => {
          const own = variant.imageId ? (thumbnails.get(variant.imageId) ?? null) : null;
          return (
            <tr key={variant.id} className={rowClass}>
              <td />
              <td className={cn(variantCell, variantIndent)}>
                <span className="flex min-w-0 items-center gap-3">
                  <Thumbnail url={own ?? cover} small muted={!own} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body">{variant.name ?? variant.sku}</span>
                    <span className="font-mono text-code text-ink-muted">{variant.sku}</span>
                  </span>
                </span>
              </td>
              <td className={columns.category.cell} />
              <td className={columns.variants.cell} />
              <td className={columns.options.cell} />
              <td className={cn(variantCell, 'text-right text-body tabular-nums')}>
                {formatAmount(variant.price, SHOP_CURRENCY)}
              </td>
              <td className={cn(variantCell, 'text-right')}>
                <StockFigure stock={variant.stock} level={stockLevelOf(variant.stock)} />
              </td>
              <td className={cn(variantCell, columns.status.cell)}>
                <Link
                  to="/catalog/products/$productId"
                  params={{ productId: product.id }}
                  className="text-label text-link hover:underline"
                >
                  {t('list.editStock')}
                </Link>
              </td>
            </tr>
          );
        })}
        {hidden > 0 && (
          <tr className={rowClass}>
            <td />
            <td colSpan={7} className={cn(variantCell, variantIndent)}>
              <Button variant="link" size="sm" onClick={() => setShowAll(true)}>
                <ChevronDown aria-hidden strokeWidth={1.5} />
                {t('list.showMore', { count: hidden })}
              </Button>
            </td>
          </tr>
        )}
      </>
    );
  }

  if (detail.isError) {
    return (
      <tr className={rowClass}>
        <td />
        <td colSpan={7} className={cn(variantCell, variantIndent)}>
          <span className="flex flex-wrap items-center gap-3">
            <CircleAlert aria-hidden strokeWidth={1.5} className="size-5 text-danger" />
            <span role="alert" className="text-body">
              {t('list.variantsFailed', { name: productName })}
            </span>
            <Button size="sm" onClick={onRetry}>
              {t('common:actions.retry')}
            </Button>
          </span>
        </td>
      </tr>
    );
  }

  // As many placeholders as there are variants to come, up to the preview, so nothing jumps.
  return (
    <>
      {Array.from({ length: Math.min(variantCount, VARIANT_PREVIEW) }, (_, index) => (
        <tr key={index} aria-busy className={rowClass}>
          <td />
          <td className={cn(variantCell, variantIndent)}>
            {index === 0 && (
              <span role="status" className="sr-only">
                {t('list.variantsLoading', { name: productName })}
              </span>
            )}
            <span aria-hidden className="flex items-center gap-3">
              <span className="size-8 shrink-0 animate-pulse rounded-sm bg-surface-sunken" />
              <span className="flex flex-col gap-1.5">
                <span className="h-3 w-24 animate-pulse rounded-sm bg-surface-sunken" />
                <span className="h-2.5 w-20 animate-pulse rounded-sm bg-surface-sunken" />
              </span>
            </span>
          </td>
          <td className={columns.category.cell} />
          <td className={columns.variants.cell} />
          <td className={columns.options.cell} />
          <td className={variantCell}>
            <span
              aria-hidden
              className="ml-auto block h-3 w-14 animate-pulse rounded-sm bg-surface-sunken"
            />
          </td>
          <td className={variantCell}>
            <span
              aria-hidden
              className="ml-auto block h-3 w-10 animate-pulse rounded-sm bg-surface-sunken"
            />
          </td>
          <td className={cn(variantCell, columns.status.cell)}>
            <span
              aria-hidden
              className="block h-3 w-16 animate-pulse rounded-sm bg-surface-sunken"
            />
          </td>
        </tr>
      ))}
    </>
  );
}

/** The count, a coloured dot and its word for screen readers; `notes` sit before it ("2 low"). */
function StockFigure({
  stock,
  level,
  notes = [],
}: {
  stock: number;
  level: StockLevel;
  notes?: string[];
}) {
  const { stockLevel } = useStatusLabels();

  return (
    <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
      {notes.length > 0 && <span className="text-small text-ink-muted">{notes.join(', ')}</span>}
      <span className="text-body tabular-nums">{stock}</span>
      <span
        aria-hidden
        className={cn('size-2 shrink-0 rounded-full', statusToneDotClasses[stockLevelTones[level]])}
      />
      <span className="sr-only">{stockLevel(level)}</span>
    </span>
  );
}

/** A product or variant photo; decorative, since the name sits beside it. */
function Thumbnail({
  url,
  small,
  muted,
}: {
  url: string | null;
  small?: boolean;
  muted?: boolean;
}) {
  const box = small ? 'size-8 rounded-sm' : 'size-10 rounded-md';

  if (!url) {
    return (
      <span
        aria-hidden
        className={cn(
          box,
          'flex shrink-0 items-center justify-center bg-surface-sunken text-ink-muted',
        )}
      >
        <ImageIcon strokeWidth={1.5} className="size-4" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={cn(box, 'shrink-0 bg-surface-sunken object-cover', muted && 'opacity-60')}
    />
  );
}
