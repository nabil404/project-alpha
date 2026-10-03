import { useMemo } from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import type { CategoryWithCount, ProductListItem } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { useToast } from '@/lib/toast';

import { useCategories, useCategoryProducts, useDeleteCategory } from '../queries';

/** How many of the category's products the dialog names; the rest are counted. */
const SHOWN_PRODUCTS = 5;

/**
 * Confirms deleting a category, naming the products it comes off and warning
 * when some of them will be left with no category at all. Open while
 * `category` is set.
 */
export function DeleteCategoryDialog({
  category,
  onClose,
}: {
  category: CategoryWithCount | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError } = useErrorMessages();
  const toast = useToast();
  const remove = useDeleteCategory();

  return (
    <AlertDialog
      open={category !== null}
      onOpenChange={(open) => {
        // Not while the request is out: closing would hide its outcome.
        if (open || remove.isPending) return;
        remove.reset();
        onClose();
      }}
    >
      {category && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('categories.delete.title', { name: category.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {category.productCount === 0 ? (
                t('categories.delete.empty')
              ) : (
                <Trans
                  t={t}
                  i18nKey="categories.delete.description"
                  count={category.productCount}
                  components={{ strong: <strong className="font-semibold text-ink" /> }}
                />
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {category.productCount > 0 && <AffectedProducts category={category} />}
          {remove.isError && <ErrorBanner>{forError(remove.error)}</ErrorBanner>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t('common:actions.cancel')}
            </AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: that one closes the dialog before the request answers. */}
            <Button
              type="button"
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(category.id, {
                  onSuccess: () => {
                    // The row disappears; nothing else says it worked.
                    toast.success(t('categories.delete.done', { name: category.name }));
                    remove.reset();
                    onClose();
                  },
                })
              }
            >
              <Trash2 aria-hidden strokeWidth={1.5} />
              {t('categories.delete.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}

/**
 * The first few products the category comes off, each with the categories it
 * keeps. Archived products are not listed (the product list leaves them out),
 * though `productCount` counts them.
 */
function AffectedProducts({ category }: { category: CategoryWithCount }) {
  const { t } = useTranslation('catalog');
  const products = useCategoryProducts(category.id);
  const categories = useCategories();
  const names = useMemo(
    () => new Map((categories.data ?? []).map((entry) => [entry.id, entry.name])),
    [categories.data],
  );

  if (products.isError) return <ErrorBanner>{t('categories.delete.loadFailed')}</ErrorBanner>;
  if (products.isPending) {
    return (
      <ul aria-hidden className="rounded-md border border-border">
        {Array.from({ length: Math.min(category.productCount, 3) }, (_, index) => (
          <li
            key={index}
            className="flex items-center gap-3 border-border px-3 py-2 not-first:border-t"
          >
            <span className="size-8 animate-pulse rounded-sm bg-surface-sunken" />
            <span className="h-3.5 w-36 animate-pulse rounded-sm bg-surface-sunken" />
          </li>
        ))}
      </ul>
    );
  }

  const items = products.data.data;
  const othersOf = (item: ProductListItem) =>
    item.categoryIds.flatMap((id) => {
      const name = id === category.id ? undefined : names.get(id);
      return name ? [name] : [];
    });
  const orphans = items.filter((item) => othersOf(item).length === 0).length;
  const shown = items.slice(0, SHOWN_PRODUCTS);
  const more = category.productCount - shown.length;

  return (
    <>
      {shown.length > 0 && (
        <ul
          aria-label={t('categories.delete.productsLabel', { name: category.name })}
          className="rounded-md border border-border"
        >
          {shown.map((item) => {
            const others = othersOf(item);
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 border-border px-3 py-2 not-first:border-t"
              >
                {item.coverThumbnailUrl ? (
                  <img
                    src={item.coverThumbnailUrl}
                    alt=""
                    className="size-8 shrink-0 rounded-sm object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="size-8 shrink-0 rounded-sm border border-dashed border-border-strong bg-surface-sunken"
                  />
                )}
                <span className="min-w-0 grow truncate text-body">{item.name}</span>
                <span
                  className={
                    others.length > 0
                      ? 'shrink-0 text-small text-ink-muted'
                      : 'shrink-0 text-small text-warning'
                  }
                >
                  {others.length > 0
                    ? t('categories.delete.alsoIn', { list: others.join(', ') })
                    : t('categories.delete.onlyHere')}
                </span>
              </li>
            );
          })}
          {more > 0 && (
            <li className="border-t border-border px-3 py-2 text-small text-ink-muted">
              {t('categories.delete.more', { count: more })}
            </li>
          )}
        </ul>
      )}
      {orphans > 0 && (
        <div className="flex items-start gap-2.5 rounded-md bg-warning-soft p-3 text-small text-warning">
          <TriangleAlert aria-hidden strokeWidth={1.5} className="mt-0.5 size-4 shrink-0" />
          <p>
            <Trans
              t={t}
              i18nKey="categories.delete.orphans"
              count={orphans}
              components={{ strong: <strong className="font-semibold" /> }}
            />
          </p>
        </div>
      )}
    </>
  );
}
