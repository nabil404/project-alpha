import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IMPORT_LIST_PAGE_SIZES, type ImportRun, type ListImportsQuery } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { PaginationBar } from '@/components/PaginationBar';
import { Button } from '@/components/ui/button';
import { CatalogHeader } from '@/features/catalog/components/CatalogHeader';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { isGoing, useImportRuns, useResumeImport, useStartImport } from '../queries';
import { useRangeLabel } from '../use-range-label';
import { ImportDialog } from './ImportDialog';
import { ImportRunBadge } from './ImportRunBadge';

/** Catalog › Imports: every run, newest first, with the way back into each. */
export function ImportList({
  query,
  onChange,
}: {
  query: ListImportsQuery;
  onChange: (change: Partial<ListImportsQuery>) => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError } = useErrorMessages();
  const runs = useImportRuns(query);
  const [dialogOpen, setDialogOpen] = useState(false);
  const total = runs.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  // A page past the end moves back to the last one.
  useEffect(() => {
    if (runs.data && query.page > totalPages) onChange({ page: totalPages });
  }, [runs.data, query.page, totalPages, onChange]);

  const head = 'border-t border-border px-4 py-3';

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <CatalogHeader
        section="imports"
        action={
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            <Upload aria-hidden strokeWidth={1.5} />
            {t('imports.list.importFromFacebook')}
          </Button>
        }
      />
      <ImportDialog open={dialogOpen} onOpenChange={setDialogOpen} step="dates" />

      {runs.isError ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorBanner className="self-stretch">{forError(runs.error)}</ErrorBanner>
          <Button size="sm" onClick={() => void runs.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : runs.data?.total === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-6 py-12 text-center text-body text-ink-muted shadow-card">
          {t('imports.list.empty')}
        </p>
      ) : (
        <section
          aria-labelledby="past-imports"
          className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <h2 id="past-imports" className="px-4 py-4 text-heading sm:px-6">
            {t('imports.list.title')}
          </h2>
          {/* Relative: the sr-only header must scroll with the table, not widen the page. */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse">
              <thead>
                <tr className="bg-surface-sunken text-left text-label whitespace-nowrap text-ink-muted">
                  <th scope="col" className={cn(head, 'pl-4 sm:pl-6')}>
                    {t('imports.list.columns.range')}
                  </th>
                  <th scope="col" className={head}>
                    {t('imports.list.columns.ranOn')}
                  </th>
                  <th scope="col" className={head}>
                    {t('imports.list.columns.result')}
                  </th>
                  <th scope="col" className={cn(head, 'text-right')}>
                    {t('imports.list.columns.postsRead')}
                  </th>
                  <th scope="col" className={cn(head, 'text-right')}>
                    {t('imports.list.columns.drafts')}
                  </th>
                  <th scope="col" className={cn(head, 'text-right')}>
                    {t('imports.list.columns.leftToReview')}
                  </th>
                  <th scope="col" className={cn(head, 'pr-4 sm:pr-6')}>
                    <span className="sr-only">{t('imports.list.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody
                aria-busy={runs.isPlaceholderData || undefined}
                className={cn(
                  'transition-opacity duration-200',
                  runs.isPlaceholderData && 'opacity-60',
                )}
              >
                {runs.isPending
                  ? Array.from({ length: 3 }, (_, index) => (
                      <tr key={index} aria-hidden className="border-t border-border">
                        {Array.from({ length: 7 }, (_, cell) => (
                          <td key={cell} className="px-4 py-4">
                            <span className="block h-3.5 w-16 animate-pulse rounded-sm bg-surface-sunken" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : runs.data.data.map((run) => <ImportRow key={run.id} run={run} />)}
              </tbody>
            </table>
          </div>
          {total > 0 && (
            <PaginationBar
              page={query.page}
              limit={query.limit}
              pageSizes={IMPORT_LIST_PAGE_SIZES}
              totalPages={totalPages}
              summary={t('imports.list.pagination.showing', {
                from: Math.min((query.page - 1) * query.limit + 1, total),
                to: Math.min(query.page * query.limit, total),
                count: total,
              })}
              perPageLabel={t('imports.list.pagination.perPageLabel')}
              onPageChange={(page) => onChange({ page })}
              onLimitChange={(limit) => onChange({ limit, page: 1 })}
            />
          )}
        </section>
      )}
    </div>
  );
}

function ImportRow({ run }: { run: ImportRun }) {
  const { t } = useTranslation('catalog');
  const { forCode } = useErrorMessages();
  const { formatDate, formatNumber } = useFormatters();
  const rangeLabel = useRangeLabel();
  const navigate = useNavigate();
  const toast = useToast();
  const resume = useResumeImport();
  const retry = useStartImport();
  const open = () =>
    void navigate({ to: '/catalog/imports/$importId', params: { importId: run.id } });

  const skipped = run.notProducts + run.inCatalog + run.alreadyImported;
  const note =
    run.status === 'failed'
      ? run.errorCode && forCode(run.errorCode)
      : run.status === 'stopped'
        ? run.postsTotal !== null
          ? t('imports.list.stoppedAt', { read: run.postsRead, total: run.postsTotal })
          : t('imports.list.stoppedAfter', { count: run.postsRead })
        : run.status === 'finished'
          ? t('imports.list.finishedNote', { skipped, merged: run.merged })
          : null;
  const cell = 'border-t border-border px-4 py-3 align-top';
  const number = cn(cell, 'text-right tabular-nums');

  return (
    <tr className="text-body hover:bg-surface-hover">
      <th scope="row" className={cn(cell, 'pl-4 text-left font-medium whitespace-nowrap sm:pl-6')}>
        <Link
          to="/catalog/imports/$importId"
          params={{ importId: run.id }}
          className="hover:text-accent"
        >
          {rangeLabel(run)}
        </Link>
      </th>
      <td className={cn(cell, 'whitespace-nowrap text-ink-muted')}>
        {formatDate(run.createdAt, 'dateTime')}
      </td>
      <td className={cn(cell, 'min-w-56')}>
        <div className="flex flex-col items-start gap-1">
          <ImportRunBadge status={run.status} />
          {note && <span className="max-w-64 text-small text-ink-muted">{note}</span>}
        </div>
      </td>
      <td className={number}>{formatNumber(run.postsRead)}</td>
      <td className={number}>{formatNumber(run.drafts)}</td>
      <td
        className={cn(
          number,
          run.leftToReview > 0
            ? 'text-warning'
            : run.drafts > 0
              ? 'text-success'
              : 'text-ink-muted',
        )}
      >
        {run.leftToReview > 0
          ? t('imports.list.leftDrafts', { count: run.leftToReview })
          : run.drafts > 0
            ? t('imports.list.allReviewed')
            : t('list.noValue')}
      </td>
      <td className={cn(cell, 'pr-4 text-right whitespace-nowrap sm:pr-6')}>
        {run.status === 'stopped' ? (
          <Button
            size="sm"
            disabled={resume.isPending}
            onClick={() => resume.mutate(run.id, { onSuccess: open, onError: toast.error })}
          >
            {t('imports.list.resume')}
          </Button>
        ) : run.status === 'failed' ? (
          <Button
            size="sm"
            disabled={retry.isPending}
            onClick={() =>
              retry.mutate(
                { source: run.source, since: run.since, until: run.until },
                {
                  onSuccess: (next) =>
                    void navigate({
                      to: '/catalog/imports/$importId',
                      params: { importId: next.id },
                    }),
                  onError: toast.error,
                },
              )
            }
          >
            {t('imports.list.tryAgain')}
          </Button>
        ) : (
          <Button size="sm" variant={isGoing(run.status) ? 'secondary' : 'ghost'} onClick={open}>
            {t('imports.list.open')}
          </Button>
        )}
      </td>
    </tr>
  );
}
