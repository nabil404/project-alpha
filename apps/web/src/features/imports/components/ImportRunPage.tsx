import { Link } from '@tanstack/react-router';
import { Check, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import {
  importPostFilters,
  type ImportPost,
  type ImportPostFilter,
  type ImportRun,
} from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useFacebookPage } from '@/features/messenger/queries';
import { useErrorMessages } from '@/i18n/error-keys';
import type { StatusTone } from '@/i18n/status-tones';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { isGoing, useImportPosts, useImportRun, useResumeImport, useStopImport } from '../queries';
import { useRangeLabel } from '../use-range-label';
import { ImportPostTab } from './ImportPostTab';
import { Pill, PostThumb } from './PostBits';

/** How many of the latest posts the running view shows. */
const LATEST_POSTS = 6;

export interface ImportRunSearch {
  tab: ImportPostFilter;
  page: number;
  limit: number;
}

/**
 * One run: its progress while it goes, then what it found, with the drafts
 * to fill in, those ready to activate, and the posts it skipped.
 */
export function ImportRunPage({
  importId,
  search,
  onChange,
}: {
  importId: string;
  search: ImportRunSearch;
  onChange: (change: Partial<ImportRunSearch>) => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError } = useErrorMessages();
  const { formatDate } = useFormatters();
  const run = useImportRun(importId);
  const page = useFacebookPage();
  const stop = useStopImport(importId);
  const rangeLabel = useRangeLabel();

  if (run.isError) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-3">
        <ErrorBanner className="self-stretch">{forError(run.error)}</ErrorBanner>
        <Button asChild size="sm">
          <Link to="/catalog/imports">{t('list.tabs.imports')}</Link>
        </Button>
      </div>
    );
  }
  if (!run.data) {
    return (
      <div aria-hidden className="mx-auto flex max-w-7xl flex-col gap-6">
        <span className="h-9 w-72 animate-pulse rounded-md bg-surface-sunken" />
        <span className="h-40 animate-pulse rounded-lg bg-surface-sunken" />
      </div>
    );
  }

  const data = run.data;
  const going = isGoing(data.status);
  const range = rangeLabel(data);
  const meta = [
    page.data?.page?.name,
    range,
    going
      ? t('imports.run.meta.startedAt', {
          time: formatDate(data.startedAt ?? data.createdAt, 'time'),
        })
      : data.finishedAt &&
        t('imports.run.meta.finishedAt', { time: formatDate(data.finishedAt, 'time') }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 animate-in fade-in-0 duration-200">
      <nav aria-label={t('editor.breadcrumb')}>
        <ol className="flex min-w-0 flex-wrap items-center gap-1 text-small text-ink-muted">
          <li className="shrink-0">
            <Link to="/catalog" className="hover:text-ink">
              {t('list.title')}
            </Link>
          </li>
          <Chevron />
          <li className="shrink-0">
            <Link to="/catalog/imports" className="hover:text-ink">
              {t('list.tabs.imports')}
            </Link>
          </li>
          <Chevron />
          <li aria-current="page" className="text-ink">
            {range}
          </li>
        </ol>
      </nav>

      <header className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 grow flex-col gap-1">
          <h1 className="text-display">{t(`imports.run.titles.${data.status}`)}</h1>
          <p className="text-body text-ink-muted">{meta}</p>
        </div>
        {(data.status === 'queued' || data.status === 'running') && (
          <Button variant="danger" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {t('imports.run.stop')}
          </Button>
        )}
      </header>
      {stop.isError && <ErrorBanner>{forError(stop.error)}</ErrorBanner>}

      {going ? (
        <RunningView run={data} />
      ) : (
        <SummaryView run={data} search={search} onChange={onChange} />
      )}
    </div>
  );
}

function Chevron() {
  return (
    <li aria-hidden className="flex text-border-strong">
      <ChevronRight className="size-3.5" strokeWidth={1.5} />
    </li>
  );
}

function RunningView({ run }: { run: ImportRun }) {
  const { t } = useTranslation('catalog');
  const { formatNumber, formatPercent } = useFormatters();
  // Polls with the run, so the latest posts move as it reads.
  const latest = useImportPosts(run.id, { page: 1, limit: 10 }, 3000);
  const total = run.postsTotal;
  const fraction = total ? Math.min(run.postsRead / total, 1) : null;
  const heading =
    run.status === 'queued'
      ? t('imports.run.queued')
      : run.status === 'stopping'
        ? t('imports.run.stopping')
        : total !== null
          ? t('imports.run.reading', {
              read: formatNumber(Math.min(run.postsRead + 1, total)),
              total: formatNumber(total),
            })
          : t('imports.run.readingSoFar', { read: formatNumber(run.postsRead + 1) });

  return (
    <>
      <section
        aria-labelledby="import-progress"
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="import-progress" aria-live="polite" className="text-heading">
            {heading}
          </h2>
          {fraction !== null && (
            <span className="text-body text-ink-muted tabular-nums">{formatPercent(fraction)}</span>
          )}
        </div>
        <div
          role="progressbar"
          aria-label={t('imports.run.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={total ?? undefined}
          aria-valuenow={total !== null ? run.postsRead : undefined}
          className="h-2 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className={cn(
              'h-full rounded-full bg-accent transition-[width] duration-500',
              fraction === null && 'w-1/3 animate-pulse',
            )}
            style={fraction !== null ? { width: `${fraction * 100}%` } : undefined}
          />
        </div>
        <p className="text-small text-ink-muted">{t('imports.run.leaveNote')}</p>
        <Counts
          tile="bg-bg"
          items={[
            ['imports.run.counts.draftsSoFar', run.drafts],
            ['imports.run.counts.notProducts', run.notProducts],
            ['imports.run.counts.merged', run.merged],
            ['imports.run.counts.alreadyImported', run.alreadyImported],
          ]}
        />
      </section>

      <section
        aria-labelledby="latest-posts"
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        <h2 id="latest-posts" className="px-4 py-4 text-heading sm:px-6">
          {t('imports.run.latest')}
        </h2>
        {latest.data?.data.length ? (
          <ul>
            {latest.data.data.slice(0, LATEST_POSTS).map((post) => (
              <LatestPost key={post.id} post={post} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-border px-4 py-6 text-body text-ink-muted sm:px-6">
            {t('imports.run.noPostsYet')}
          </p>
        )}
      </section>
    </>
  );
}

const resultTones = {
  draft: 'accent',
  merged: 'warning',
  not_a_product: 'neutral',
  no_caption_or_photo: 'neutral',
  no_named_product: 'neutral',
  in_catalog: 'neutral',
  already_imported: 'neutral',
  llm_failed: 'danger',
  photo_unreadable: 'danger',
  write_failed: 'danger',
} as const satisfies Record<ImportPost['result'], StatusTone>;

function LatestPost({ post }: { post: ImportPost }) {
  const { t } = useTranslation('catalog');
  const { formatDate } = useFormatters();
  const names = post.products.map((product) => product.name).join(', ');
  const result =
    post.result === 'draft' && post.products.length > 0
      ? t('imports.run.postResult.draft', { count: post.products.length, names })
      : post.result === 'merged' && names
        ? t('imports.run.postResult.merged', { names })
        : t(`imports.run.postResult.${post.result === 'draft' ? 'draftNone' : post.result}`);

  return (
    <li className="flex items-center gap-4 border-t border-border px-4 py-3 sm:px-6">
      <PostThumb post={post} />
      <span className="flex min-w-0 grow flex-col">
        <span className="truncate text-body">
          {post.caption?.trim() || t('imports.run.noCaption')}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-small text-ink-muted">
          {post.createdTime && formatDate(post.createdTime)}
          <Pill tone={resultTones[post.result]} className="sm:hidden">
            {result}
          </Pill>
        </span>
      </span>
      <Pill tone={resultTones[post.result]} className="max-sm:hidden">
        {result}
      </Pill>
    </li>
  );
}

type CountItem = readonly [ParseKeys<'catalog'>, number];

function Counts({ items, tile }: { items: CountItem[]; tile: string }) {
  const { t } = useTranslation('catalog');
  const { formatNumber } = useFormatters();

  return (
    <dl
      aria-label={t('imports.run.counts.label')}
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {items.map(([label, value]) => (
        <div key={label} className={cn('flex flex-col-reverse gap-0.5 rounded-md p-4', tile)}>
          <dt className="text-small text-ink-muted">{t(label)}</dt>
          <dd className="text-stat tabular-nums">{formatNumber(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SummaryView({
  run,
  search,
  onChange,
}: {
  run: ImportRun;
  search: ImportRunSearch;
  onChange: (change: Partial<ImportRunSearch>) => void;
}) {
  const { t } = useTranslation('catalog');
  const { forCode } = useErrorMessages();
  const toast = useToast();
  const resume = useResumeImport();
  // Each tab's count, from the first page that tab itself shows.
  const totals: Record<ImportPostFilter, ReturnType<typeof useImportPosts>> = {
    needs_info: useImportPosts(run.id, { result: 'needs_info', page: 1, limit: search.limit }),
    ready: useImportPosts(run.id, { result: 'ready', page: 1, limit: search.limit }),
    skipped: useImportPosts(run.id, { result: 'skipped', page: 1, limit: search.limit }),
  };

  return (
    <>
      {run.status === 'failed' && (
        <ErrorBanner>
          {run.errorCode ? `${forCode(run.errorCode)} ` : ''}
          {t('imports.run.failedHint')}
        </ErrorBanner>
      )}
      {run.status === 'stopped' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft px-4 py-3"
        >
          <p className="grow text-body text-ink">{t('imports.run.stopped')}</p>
          <Button
            size="sm"
            disabled={resume.isPending}
            onClick={() => resume.mutate(run.id, { onError: toast.error })}
          >
            {t('imports.run.resume')}
          </Button>
        </div>
      )}
      {run.leftToReview > 0 && (
        <div role="status" className="flex items-start gap-3 rounded-lg bg-success-soft px-4 py-3">
          <Check aria-hidden strokeWidth={1.5} className="mt-0.5 size-5 shrink-0 text-success" />
          <p className="text-body text-ink">
            <strong className="font-semibold">
              {t('imports.run.waiting', { count: run.leftToReview })}
            </strong>{' '}
            {t('imports.run.waitingHint')}
          </p>
        </div>
      )}

      <Counts
        tile="rounded-lg border border-border bg-surface shadow-card"
        items={[
          ['imports.run.counts.postsRead', run.postsRead],
          ['imports.run.counts.drafts', run.drafts],
          ['imports.run.counts.mergedInto', run.merged],
          ['imports.run.counts.skipped', run.notProducts + run.inCatalog + run.alreadyImported],
        ]}
      />

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <div
          role="tablist"
          aria-label={t('imports.run.tabs.label')}
          className="flex gap-6 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:px-6"
        >
          {importPostFilters.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={search.tab === tab}
              onClick={() => onChange({ tab, page: 1 })}
              className={cn(
                '-mb-px flex h-12 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-1 text-body font-medium whitespace-nowrap transition-colors duration-[120ms]',
                search.tab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-ink hover:text-accent',
              )}
            >
              {t(`imports.run.tabs.${tab}`)}
              {totals[tab].data && (
                <span className="text-ink-muted tabular-nums">{totals[tab].data.total}</span>
              )}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          <ImportPostTab
            key={search.tab}
            run={run}
            tab={search.tab}
            page={search.page}
            limit={search.limit}
            onChange={onChange}
          />
        </div>
      </section>
    </>
  );
}
