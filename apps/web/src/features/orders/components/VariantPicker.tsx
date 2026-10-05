import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProductListItem } from '@app/shared';

import { SearchInput } from '@/components/SearchInput';
import { Button } from '@/components/ui/button';
import { productQueryOptions, useProductList } from '@/features/catalog';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import { variantDisplayName } from '../format';

/** A variant as the picker hands it over: enough to show the line before the order is saved. */
export interface PickedVariant {
  variantId: string;
  label: string;
  sku: string;
  price: number;
  stock: number;
}

/**
 * Finds a product and one of its variants to add to an order. Products that
 * vary list their variants on demand; one with a single variant is picked
 * straight away. Archived products never show, so every choice is one the
 * order can take. Variants already on the order are disabled.
 */
export function VariantPicker({
  taken,
  onPick,
}: {
  taken: ReadonlySet<string>;
  onPick: (variant: PickedVariant) => void;
}) {
  const { t } = useTranslation('orders');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<string | null>(null);
  const products = useProductList({ filter: 'all', q, page: 1, limit: 10 });

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} className="self-start">
        <Plus aria-hidden strokeWidth={1.5} />
        {t('items.add')}
      </Button>
    );
  }

  const pick = (variant: PickedVariant) => {
    onPick(variant);
    setOpen(false);
    setExpanded(null);
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <SearchInput
          value={q}
          onChange={setQ}
          label={t('items.searchLabel')}
          placeholder={t('items.searchPlaceholder')}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('items.closePicker')}
          onClick={() => setOpen(false)}
        >
          <X aria-hidden strokeWidth={1.5} />
        </Button>
      </div>
      {products.isPending ? (
        <span aria-hidden className="h-24 animate-pulse rounded-md bg-surface-sunken" />
      ) : products.isError || products.data.data.length === 0 ? (
        <p className="text-small text-ink-muted">
          {products.isError ? t('items.searchFailed') : t('items.noProducts')}
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {products.data.data.map((product) => (
            <ProductOption
              key={product.id}
              product={product}
              taken={taken}
              expanded={expanded === product.id}
              onToggle={() => setExpanded(expanded === product.id ? null : product.id)}
              onPick={pick}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductOption({
  product,
  taken,
  expanded,
  onToggle,
  onPick,
}: {
  product: ProductListItem;
  taken: ReadonlySet<string>;
  expanded: boolean;
  onToggle: () => void;
  onPick: (variant: PickedVariant) => void;
}) {
  const { t } = useTranslation('orders');
  const { formatMoney } = useFormatters();
  const lone = product.variant;

  if (lone) {
    return (
      <li>
        <OptionButton
          disabled={taken.has(lone.id)}
          onClick={() =>
            onPick({
              variantId: lone.id,
              label: variantDisplayName(product.name, lone.name),
              sku: lone.sku,
              price: lone.price,
              stock: lone.stock,
            })
          }
          title={variantDisplayName(product.name, lone.name)}
          detail={t('items.optionDetail', {
            price: formatMoney(lone.price),
            stock: lone.stock,
          })}
        />
      </li>
    );
  }

  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-surface-hover"
      >
        <Chevron aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-ink-muted" />
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-body">{product.name}</span>
          <span className="text-small text-ink-muted">
            {t('items.variantCount', { count: product.variantCount })}
          </span>
        </span>
      </button>
      {expanded && <ProductVariants product={product} taken={taken} onPick={onPick} />}
    </li>
  );
}

function ProductVariants({
  product,
  taken,
  onPick,
}: {
  product: ProductListItem;
  taken: ReadonlySet<string>;
  onPick: (variant: PickedVariant) => void;
}) {
  const { t } = useTranslation('orders');
  const { formatMoney } = useFormatters();
  const detail = useQuery(productQueryOptions(product.id));

  if (detail.isPending) {
    return <span aria-hidden className="ml-8 h-10 animate-pulse rounded-md bg-surface-sunken" />;
  }
  if (detail.isError) {
    return <p className="ml-8 text-small text-ink-muted">{t('items.searchFailed')}</p>;
  }
  return (
    <ul className="ml-6 flex flex-col">
      {detail.data.variants.map((variant) => (
        <li key={variant.id}>
          <OptionButton
            disabled={taken.has(variant.id)}
            onClick={() =>
              onPick({
                variantId: variant.id,
                label: variantDisplayName(product.name, variant.name),
                sku: variant.sku,
                price: variant.price,
                stock: variant.stock,
              })
            }
            title={variant.name ?? product.name}
            detail={t('items.optionDetail', {
              price: formatMoney(variant.price),
              stock: variant.stock,
            })}
          />
        </li>
      ))}
    </ul>
  );
}

function OptionButton({
  title,
  detail,
  disabled,
  onClick,
}: {
  title: string;
  detail: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('orders');
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-hover',
        'disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent',
      )}
    >
      <span className="min-w-0 truncate text-body">{title}</span>
      <span className="shrink-0 text-small text-ink-muted">
        {disabled ? t('items.alreadyAdded') : detail}
      </span>
    </button>
  );
}
