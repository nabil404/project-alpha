import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  PRODUCT_LIST_PAGE_SIZES,
  updateCategorySchema,
  type CategoryWithCount,
  type UpdateCategory,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useErrorMessages } from '@/i18n/error-keys';
import { applyServerFieldErrors, useZodResolver } from '@/lib/form';
import { currentLocale } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { useCategories, useCreateCategory, useRenameCategory } from '../queries';
import { CatalogHeader } from './CatalogHeader';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';
import { PaginationBar } from './PaginationBar';

type SortKey = 'name' | 'count';
interface Sort {
  key: SortKey;
  direction: 'asc' | 'desc';
}

/** Names read A to Z first; counts read most first, the question being which are biggest. */
const FIRST_DIRECTION = { name: 'asc', count: 'desc' } as const satisfies Record<
  SortKey,
  Sort['direction']
>;

/** One row at a time is a form: a category being renamed, or the new one being added. */
type Editing = { kind: 'rename'; id: string } | { kind: 'add' } | null;

/**
 * The Categories page. The API returns every category at once, so search,
 * sort and paging happen here, over the cached list.
 */
export function CategoryList() {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError } = useErrorMessages();
  const categories = useCategories();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'name', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(PRODUCT_LIST_PAGE_SIZES[0]);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<CategoryWithCount | null>(null);

  const rows = useMemo(() => {
    const collator = new Intl.Collator(currentLocale(), { sensitivity: 'base', numeric: true });
    const term = search.trim().toLocaleLowerCase();
    const matching = (categories.data ?? []).filter((category) =>
      category.name.toLocaleLowerCase().includes(term),
    );
    const sign = sort.direction === 'asc' ? 1 : -1;
    return matching.sort(
      (a, b) =>
        sign *
        (sort.key === 'count'
          ? a.productCount - b.productCount || collator.compare(a.name, b.name)
          : collator.compare(a.name, b.name)),
    );
  }, [categories.data, search, sort]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(page, totalPages);
  const shown = rows.slice((currentPage - 1) * limit, currentPage * limit);

  // A page past the end (its last category deleted, say) moves back to the last one.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const onSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: FIRST_DIRECTION[key] },
    );
    setPage(1);
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <CatalogHeader section="categories" />

      <section
        aria-label={t('categories.label')}
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        <div className="px-4 py-4 sm:px-6">
          <div className="relative flex w-full items-center sm:w-72">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 size-4 text-ink-muted"
              strokeWidth={1.5}
            />
            <Input
              type="search"
              aria-label={t('categories.searchLabel')}
              placeholder={t('categories.searchPlaceholder')}
              maxLength={80}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
        </div>

        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[20rem] table-fixed border-collapse">
            <colgroup>
              <col />
              <col className="w-24 sm:w-36" />
              <col className="w-24 sm:w-56" />
            </colgroup>
            <thead>
              <tr className="text-left text-label whitespace-nowrap text-ink-muted">
                <SortableHeader
                  sortKey="name"
                  sort={sort}
                  onSort={onSort}
                  className="pr-4 pl-4 sm:pl-6"
                >
                  {t('categories.columns.name')}
                </SortableHeader>
                <SortableHeader sortKey="count" sort={sort} onSort={onSort} className="px-4">
                  {t('categories.columns.products')}
                </SortableHeader>
                <th
                  scope="col"
                  className="border-t border-border py-3 pr-4 pl-4 text-right sm:pr-6"
                >
                  {t('categories.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.isError ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-4 py-6 sm:px-6">
                    <div className="flex flex-col items-start gap-3">
                      <ErrorBanner className="self-stretch">
                        {forError(categories.error)}
                      </ErrorBanner>
                      <Button size="sm" onClick={() => void categories.refetch()}>
                        {t('common:actions.retry')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : categories.isPending ? (
                <TableSkeleton />
              ) : (
                <>
                  {total === 0 && editing?.kind !== 'add' && (
                    <tr className="border-t border-border">
                      <td colSpan={3} className="px-4 py-12 text-center sm:px-6">
                        <p className="text-body text-ink-muted">
                          {categories.data.length === 0
                            ? t('categories.empty')
                            : t('categories.emptyFiltered')}
                        </p>
                      </td>
                    </tr>
                  )}
                  {shown.map((category) =>
                    editing?.kind === 'rename' && editing.id === category.id ? (
                      <NameEditorRow
                        key={category.id}
                        category={category}
                        onDone={() => setEditing(null)}
                      />
                    ) : (
                      <CategoryRow
                        key={category.id}
                        category={category}
                        onEdit={() => setEditing({ kind: 'rename', id: category.id })}
                        onDelete={() => setDeleting(category)}
                      />
                    ),
                  )}
                  {editing?.kind === 'add' && <NameEditorRow onDone={() => setEditing(null)} />}
                </>
              )}
            </tbody>
          </table>
        </div>

        {categories.isSuccess && editing?.kind !== 'add' && (
          <div className="border-t border-border px-4 py-3 sm:px-6">
            <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: 'add' })}>
              <Plus aria-hidden strokeWidth={1.5} />
              {t('categories.add')}
            </Button>
          </div>
        )}

        {total > 0 && (
          <PaginationBar
            page={currentPage}
            limit={limit}
            totalPages={totalPages}
            summary={t('categories.pagination.showing', {
              from: (currentPage - 1) * limit + 1,
              to: Math.min(currentPage * limit, total),
              count: total,
            })}
            perPageLabel={t('categories.pagination.perPageLabel')}
            onPageChange={setPage}
            onLimitChange={(next) => {
              setLimit(next);
              setPage(1);
            }}
          />
        )}
      </section>

      <DeleteCategoryDialog category={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function SortableHeader({
  sortKey,
  sort,
  onSort,
  className,
  children,
}: {
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
  children: string;
}) {
  const { t } = useTranslation('catalog');
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  const hint = !active
    ? t(sortKey === 'name' ? 'categories.sort.byName' : 'categories.sort.byCount')
    : sortKey === 'name'
      ? t(sort.direction === 'asc' ? 'categories.sort.nameAsc' : 'categories.sort.nameDesc')
      : t(sort.direction === 'asc' ? 'categories.sort.countAsc' : 'categories.sort.countDesc');

  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('border-t border-border py-2', className)}
    >
      <button
        type="button"
        title={hint}
        onClick={() => onSort(sortKey)}
        className={cn(
          '-mx-2 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm px-2 hover:bg-surface-hover hover:text-ink',
          active && 'text-ink',
        )}
      >
        {children}
        <Icon
          aria-hidden
          strokeWidth={1.5}
          className={cn('size-3.5', !active && 'text-ink-disabled')}
        />
      </button>
    </th>
  );
}

function CategoryRow({
  category,
  onEdit,
  onDelete,
}: {
  category: CategoryWithCount;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('catalog');

  return (
    <tr className="border-t border-border">
      <td className="truncate py-3 pr-4 pl-4 text-body sm:pl-6">{category.name}</td>
      <td className="px-4 py-3 text-body tabular-nums">{category.productCount}</td>
      <td className="py-2 pr-4 pl-4 sm:pr-6">
        <span className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('categories.editLabel', { name: category.name })}
            title={t('categories.editLabel', { name: category.name })}
            onClick={onEdit}
          >
            <Pencil aria-hidden strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('categories.deleteLabel', { name: category.name })}
            title={t('categories.deleteLabel', { name: category.name })}
            onClick={onDelete}
            className="hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 aria-hidden strokeWidth={1.5} />
          </Button>
        </span>
      </td>
    </tr>
  );
}

/**
 * A row as a form: renames `category`, or adds a new one without it. Enter
 * saves and Escape cancels. A refused name (taken, too long) shows under the
 * box, which stays open to fix it.
 */
function NameEditorRow({ category, onDone }: { category?: CategoryWithCount; onDone: () => void }) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError, forField } = useErrorMessages();
  const toast = useToast();
  const create = useCreateCategory();
  const rename = useRenameCategory();
  const pending = create.isPending || rename.isPending;
  const formId = useId();
  const errorId = `${formId}-error`;
  const form = useForm<UpdateCategory>({
    resolver: useZodResolver(updateCategorySchema),
    defaultValues: { name: category?.name ?? '' },
  });
  const error = form.formState.errors.name?.message;

  const onError = (failure: unknown) => {
    if (!applyServerFieldErrors(failure, form.setError, ['name'], forField)) {
      form.setError('name', { type: 'server', message: forError(failure) }, { shouldFocus: true });
    }
  };

  const onSubmit = form.handleSubmit(({ name }) => {
    if (category) {
      if (name === category.name) return onDone();
      rename.mutate({ id: category.id, input: { name } }, { onSuccess: onDone, onError });
    } else {
      create.mutate(
        { name },
        {
          onSuccess: (created) => {
            // The new row may sort onto another page, so say it worked.
            toast.success(t('categories.added', { name: created.name }));
            onDone();
          },
          onError,
        },
      );
    }
  });

  return (
    <tr className="border-t border-border bg-surface-hover/40">
      <td className="py-2 pr-4 pl-4 align-top sm:pl-6">
        <form id={formId} noValidate onSubmit={(event) => void onSubmit(event)}>
          <Input
            {...form.register('name')}
            autoFocus
            aria-label={t('categories.nameLabel')}
            placeholder={category ? undefined : t('categories.newPlaceholder')}
            maxLength={80}
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onDone();
              }
            }}
          />
          {error && (
            <p id={errorId} className="mt-1.5 text-small text-danger">
              {error}
            </p>
          )}
        </form>
      </td>
      <td className="px-4 py-2 align-top">
        <span className="flex h-10 items-center text-body text-ink-muted tabular-nums">
          {category?.productCount ?? 0}
        </span>
      </td>
      <td className="py-2 pr-4 pl-4 align-top sm:pr-6">
        <span className="flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={onDone} className="h-10">
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending} className="h-10">
            <Check aria-hidden strokeWidth={1.5} />
            {t('common:actions.save')}
          </Button>
        </span>
      </td>
    </tr>
  );
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <tr key={index} aria-hidden className="border-t border-border">
          <td className="py-4 pr-4 pl-4 sm:pl-6">
            <span className="block h-3.5 w-40 animate-pulse rounded-sm bg-surface-sunken" />
          </td>
          <td className="px-4 py-4">
            <span className="block h-3.5 w-8 animate-pulse rounded-sm bg-surface-sunken" />
          </td>
          <td className="py-4 pr-4 pl-4 sm:pr-6" />
        </tr>
      ))}
    </>
  );
}
