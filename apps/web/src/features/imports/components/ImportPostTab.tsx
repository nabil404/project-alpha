import { useId, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  canImportAnyway,
  IMPORT_LIST_PAGE_SIZES,
  type ActivateImportResult,
  type ImportPost,
  type ImportPostFilter,
  type ImportProduct,
  type ImportRun,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { PaginationBar } from '@/components/PaginationBar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import {
  useActivateImport,
  useImportAnyway,
  useImportPosts,
  useRefreshWhenReadAgain,
} from '../queries';
import { Pill, PostThumb } from './PostBits';

const row = 'flex items-center gap-4 border-t border-border px-4 py-3 hover:bg-bg sm:px-6';

/** One of the summary's tabs, a page of posts at a time. */
export function ImportPostTab({
  run,
  tab,
  page,
  limit,
  onChange,
}: {
  run: ImportRun;
  tab: ImportPostFilter;
  page: number;
  limit: number;
  onChange: (change: { page: number; limit?: number }) => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError } = useErrorMessages();
  const posts = useImportPosts(run.id, { result: tab, page, limit });
  const total = posts.data?.total ?? 0;

  if (posts.isError) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <ErrorBanner className="self-stretch">{forError(posts.error)}</ErrorBanner>
        <Button size="sm" onClick={() => void posts.refetch()}>
          {t('common:actions.retry')}
        </Button>
      </div>
    );
  }
  if (!posts.data) {
    return (
      <ul aria-hidden>
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className={row}>
            <span className="size-12 animate-pulse rounded-md bg-surface-sunken" />
            <span className="h-3.5 w-48 animate-pulse rounded-sm bg-surface-sunken" />
          </li>
        ))}
      </ul>
    );
  }
  if (posts.data.data.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-body text-ink-muted">
        {t(`imports.run.empty.${tab}`)}
      </p>
    );
  }

  const shown = posts.data.data.reduce(
    (sum, post) => sum + (tab === 'skipped' ? 1 : post.products.length),
    0,
  );

  return (
    <div
      aria-busy={posts.isPlaceholderData || undefined}
      className={cn('transition-opacity duration-200', posts.isPlaceholderData && 'opacity-60')}
    >
      {tab !== 'ready' && (
        <p className="px-4 pt-4 pb-2 text-small text-ink-muted sm:px-6">
          {t(`imports.run.intro.${tab}`)}
        </p>
      )}
      {tab === 'needs_info' && <NeedsInfo posts={posts.data.data} />}
      {tab === 'ready' && <Ready runId={run.id} posts={posts.data.data} />}
      {tab === 'skipped' && <Skipped runId={run.id} posts={posts.data.data} />}
      {tab !== 'skipped' && total <= limit && (
        <p className="border-t border-border px-4 py-3 text-small text-ink-muted sm:px-6">
          {t('imports.run.showing', { shown, count: shown })} ·{' '}
          <Link to="/catalog" search={{ importId: run.id }} className="font-medium text-link">
            {t('imports.run.seeAll')}
          </Link>
        </p>
      )}
      {total > limit && (
        <PaginationBar
          page={page}
          limit={limit}
          pageSizes={IMPORT_LIST_PAGE_SIZES}
          totalPages={Math.ceil(total / limit)}
          summary={t('imports.run.pagination.showing', {
            from: Math.min((page - 1) * limit + 1, total),
            to: Math.min(page * limit, total),
            count: total,
          })}
          perPageLabel={t('imports.run.pagination.perPageLabel')}
          onPageChange={(next) => onChange({ page: next })}
          onLimitChange={(next) => onChange({ page: 1, limit: next })}
        />
      )}
    </div>
  );
}

/** Each draft once, beside the post it came from. */
const productsOf = (posts: ImportPost[]) =>
  posts.flatMap((post) => post.products.map((product) => ({ product, post })));

function NeedsInfo({ posts }: { posts: ImportPost[] }) {
  const { t } = useTranslation('catalog');

  return (
    <ul>
      {productsOf(posts).map(({ product, post }) => (
        <li key={product.id} className={cn(row, 'flex-wrap')}>
          <ProductSummary product={product} post={post} />
          <span className="flex flex-wrap gap-1.5">
            {product.needsPrice && <Pill tone="warning">{t('imports.run.needsPrice')}</Pill>}
            {product.needsStock && <Pill tone="warning">{t('imports.run.needsStock')}</Pill>}
          </span>
          <Button asChild size="sm" className="ml-auto">
            <Link to="/catalog/products/$productId" params={{ productId: product.id }}>
              {t('imports.run.fillIn')}
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Ready({ runId, posts }: { runId: string; posts: ImportPost[] }) {
  const { t } = useTranslation('catalog');
  const { forError, forCode } = useErrorMessages();
  const toast = useToast();
  const activate = useActivateImport(runId);
  const stockId = useId();
  const rows = productsOf(posts);
  // Every draft on the page starts selected; the seller unticks any to hold back.
  const [unselected, setUnselected] = useState<Set<string>>(() => new Set());
  const [stock, setStock] = useState('');
  const [failed, setFailed] = useState<ActivateImportResult['failed']>([]);
  const chosen = rows.filter(({ product }) => !unselected.has(product.id));
  const stockValue = /^\d+$/.test(stock.trim()) ? Number(stock) : Number.NaN;
  const names = new Map(rows.map(({ product }) => [product.id, product.name]));

  const toggle = (id: string, on: boolean) =>
    setUnselected((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    activate.mutate(
      { productIds: chosen.map(({ product }) => product.id), startingStock: stockValue },
      {
        onSuccess: (result) => {
          setFailed(result.failed);
          if (result.activated.length > 0) {
            toast.success(t('imports.run.activate.done', { count: result.activated.length }));
          }
        },
      },
    );

  return (
    <>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-wrap items-center gap-4 border-b border-border bg-bg px-4 py-4 sm:px-6"
      >
        <p className="min-w-60 grow basis-80 text-small text-ink-muted">
          {t('imports.run.intro.ready')}
        </p>
        <label htmlFor={stockId} className="flex items-center gap-2 text-label">
          {t('imports.run.activate.stock')}
          <Input
            id={stockId}
            inputMode="numeric"
            autoComplete="off"
            className="h-9 w-16 tabular-nums"
            value={stock}
            onChange={(event) => setStock(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={chosen.length === 0 || Number.isNaN(stockValue) || activate.isPending}
        >
          {activate.isPending
            ? t('imports.run.activate.busy')
            : t('imports.run.activate.action', { count: chosen.length })}
        </Button>
      </form>

      {activate.isError && (
        <ErrorBanner className="mx-4 my-4 sm:mx-6">{forError(activate.error)}</ErrorBanner>
      )}
      {failed.length > 0 && (
        <div
          role="alert"
          className="mx-4 my-4 rounded-md bg-danger-soft px-4 py-3 text-small text-danger sm:mx-6"
        >
          <p>{t('imports.run.activate.failed')}</p>
          <ul className="mt-1 list-disc pl-5">
            {failed.map(({ productId, code }) => (
              <li key={productId}>{forCode(code, { name: names.get(productId) ?? '' })}</li>
            ))}
          </ul>
        </div>
      )}

      <ul>
        {rows.map(({ product, post }, index) => (
          <li key={product.id} className={cn(row, index === 0 && 'border-t-0')}>
            <Checkbox
              aria-label={t('imports.run.activate.selectProduct', { name: product.name })}
              checked={!unselected.has(product.id)}
              onCheckedChange={(on) => toggle(product.id, on === true)}
            />
            <ProductSummary product={product} post={post} />
            <Link
              to="/catalog/products/$productId"
              params={{ productId: product.id }}
              className="ml-auto text-small font-medium text-link"
            >
              {t('imports.run.review')}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function Skipped({ runId, posts }: { runId: string; posts: ImportPost[] }) {
  const { t } = useTranslation('catalog');
  const { formatDate } = useFormatters();
  const toast = useToast();
  const importAnyway = useImportAnyway(runId);
  useRefreshWhenReadAgain(runId, posts);

  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id} className={cn(row, 'flex-wrap sm:flex-nowrap')}>
          <PostThumb post={post} />
          <span className="flex min-w-0 grow basis-48 flex-col">
            <span className="truncate text-body">
              {post.caption?.trim() || t('imports.run.noCaption')}
            </span>
            <span className="text-small text-ink-muted">
              {post.createdTime && formatDate(post.createdTime)}
              {post.createdTime && post.url && ' · '}
              {post.url && (
                <a
                  href={post.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-link"
                >
                  {t('imports.run.viewPost')}
                </a>
              )}
            </span>
            {post.importAnyway && (
              <span
                role="status"
                className={cn(
                  'text-small',
                  post.importAnyway === 'queued' ? 'text-accent' : 'text-warning',
                )}
              >
                {t(`imports.run.anyway.${post.importAnyway}`)}
              </span>
            )}
          </span>
          <span className="flex w-44 shrink-0 flex-col text-small text-ink-muted">
            {post.result === 'already_imported' && post.matchedProducts.length > 0
              ? t('imports.run.linkedTo')
              : t(`imports.run.postResult.${post.result}`)}
            {post.matchedProducts.map((product) => (
              <Link
                key={product.id}
                to="/catalog/products/$productId"
                params={{ productId: product.id }}
                className="font-medium text-link"
              >
                {product.name}
              </Link>
            ))}
          </span>
          {/*
            An empty post has nothing to read, and one imported before already
            has its products; the slot keeps the rows' columns lined up.
          */}
          <Button
            size="sm"
            className={cn('ml-auto', !canImportAnyway(post.result) && 'invisible')}
            disabled={
              !canImportAnyway(post.result) ||
              post.importAnyway === 'queued' ||
              importAnyway.isPending
            }
            onClick={() => importAnyway.mutate(post.id, { onError: toast.error })}
          >
            {t('imports.run.importAnyway')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function ProductSummary({ product, post }: { product: ImportProduct; post: ImportPost }) {
  const { t } = useTranslation('catalog');
  const { formatDate } = useFormatters();
  const variants = t('imports.run.variants', { count: product.variantCount });

  return (
    <div className="flex min-w-0 grow basis-56 items-center gap-4">
      {product.coverThumbnailUrl ? (
        <img
          src={product.coverThumbnailUrl}
          alt=""
          className="size-12 shrink-0 rounded-md object-cover"
        />
      ) : (
        <PostThumb post={{ ...post, products: [] }} />
      )}
      <div className="flex min-w-0 flex-col">
        <Link
          to="/catalog/products/$productId"
          params={{ productId: product.id }}
          className="truncate text-body font-medium hover:text-accent"
        >
          {product.name}
        </Link>
        <span className="truncate text-small text-ink-muted">
          {post.createdTime
            ? t('imports.run.fromPost', { variants, date: formatDate(post.createdTime) })
            : variants}
          {post.limitsApplied && (
            <span className="text-warning"> · {t('imports.run.limitsApplied')}</span>
          )}
        </span>
      </div>
    </div>
  );
}
