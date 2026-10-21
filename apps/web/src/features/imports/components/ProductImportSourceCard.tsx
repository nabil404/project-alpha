import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Product } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import type { ProductFormValues } from '@/features/catalog/product-form';
import { useCategories, useCreateCategory } from '@/features/catalog/queries';
import { useFacebookPage } from '@/features/messenger/queries';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';

import { useProductImportSource } from '../queries';

/** "Rahim's Kitchen" → "RK". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');

/**
 * The edit page's "From this Facebook post": the caption the draft was read
 * from, a link to the post, and what was read from it. Nothing shows for a
 * product no import made.
 */
export function ProductImportSourceCard({ product }: { product: Product }) {
  const { t } = useTranslation('catalog');
  const { formatDate, formatList } = useFormatters();
  const source = useProductImportSource(product.id);
  const page = useFacebookPage();
  const post = source.data?.source?.post;
  if (!post) return null;

  const pageName = page.data?.page?.name ?? '';
  const priced = product.variants.some((variant) => variant.price !== null);
  const read: [string, string, boolean][] = [
    [t('imports.source.whatWeRead.name'), t('imports.source.whatWeRead.fromCaption'), true],
    ...product.options.map((option): [string, string, boolean] => [
      option.name,
      t('imports.source.whatWeRead.valuesFromCaption', {
        values: formatList(option.values.map((value) => value.value)),
      }),
      true,
    ]),
    [
      t('imports.source.whatWeRead.price'),
      priced ? t('imports.source.whatWeRead.fromPost') : t('imports.source.whatWeRead.notInPost'),
      priced,
    ],
    [t('imports.source.whatWeRead.stock'), t('imports.source.whatWeRead.notInPost'), false],
  ];

  return (
    <section
      aria-labelledby="import-source"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="import-source" className="text-heading">
          {t('imports.source.title')}
        </h2>
        {post.url && (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-small font-medium text-link"
          >
            {t('imports.source.viewPost')}
          </a>
        )}
      </div>
      {pageName && (
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-label text-accent"
          >
            {initials(pageName)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body font-medium">{pageName}</span>
            {post.createdTime && (
              <span className="text-small text-ink-muted">
                {t('imports.source.meta', {
                  date: formatDate(post.createdTime),
                  count: post.photoCount,
                })}
              </span>
            )}
          </span>
        </div>
      )}
      <p className="max-h-48 overflow-y-auto text-body whitespace-pre-line">
        {post.caption?.trim() || t('imports.run.noCaption')}
      </p>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-label">{t('imports.source.whatWeRead.title')}</h3>
        <dl className="flex flex-col gap-1.5 text-small">
          {read.map(([label, value, found]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-ink-muted">{label}</dt>
              <dd className={found ? 'text-right text-ink' : 'text-right text-warning'}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * A new category the import suggested, under the product's Categories.
 * Create and add makes it and puts it on the form, saved with the product;
 * once the product has it, or the seller dismisses it, it goes away.
 */
export function ImportCategorySuggestion({ productId }: { productId: string }) {
  const { t } = useTranslation('catalog');
  const { forError } = useErrorMessages();
  const toast = useToast();
  const form = useFormContext<ProductFormValues>();
  const categoryIds = useWatch<ProductFormValues, 'categoryIds'>({ name: 'categoryIds' });
  const source = useProductImportSource(productId);
  const categories = useCategories();
  const create = useCreateCategory();
  const [dismissed, setDismissed] = useState(false);
  const name = source.data?.source?.post.suggestedCategory;
  if (!name || dismissed || !categories.data) return null;
  const existing = categories.data.find(
    (category) => category.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (existing && categoryIds.includes(existing.id)) return null;

  const add = (id: string) =>
    form.setValue('categoryIds', [...form.getValues('categoryIds'), id], { shouldDirty: true });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-border-strong px-3 py-3">
      <p className="text-small text-ink-muted">
        {t('imports.source.suggestedNew')}{' '}
        <strong className="font-semibold text-ink">{name}</strong>
      </p>
      {create.isError && <ErrorBanner>{forError(create.error)}</ErrorBanner>}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          {t('imports.source.dismiss')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={create.isPending}
          onClick={() => {
            if (existing) {
              add(existing.id);
              return;
            }
            create.mutate(
              { name },
              {
                onSuccess: (category) => {
                  add(category.id);
                  toast.success(t('imports.source.categoryCreated'));
                },
              },
            );
          }}
        >
          {t('imports.source.addCategory')}
        </Button>
      </div>
    </div>
  );
}
