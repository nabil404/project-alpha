import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The first and last page, the ones either side of the current page, and gaps between. */
function pageItems(page: number, totalPages: number): (number | 'gap')[] {
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((n) => n >= 1 && n <= totalPages)
    .sort((a, b) => a - b);
  return pages.flatMap((n, index) => {
    const previous = pages[index - 1];
    if (previous === undefined || n === previous + 1) return [n];
    // A gap of one page shows that page rather than an ellipsis standing for it.
    return n === previous + 2 ? [previous + 1, n] : ['gap' as const, n];
  });
}

/**
 * The page size, what's showing, and the page buttons, under a paged table.
 * `summary` and `perPageLabel` name what the table lists; `pageSizes` are the
 * sizes its route accepts.
 */
export function PaginationBar({
  page,
  limit,
  pageSizes,
  totalPages,
  summary,
  perPageLabel,
  onPageChange,
  onLimitChange,
}: {
  page: number;
  limit: number;
  pageSizes: readonly number[];
  totalPages: number;
  summary: string;
  perPageLabel: string;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-3 sm:px-6">
      <label className="flex items-center gap-2 text-small text-ink-muted">
        {t('pagination.perPageBefore')}
        <span className="relative flex items-center">
          <select
            aria-label={perPageLabel}
            value={limit}
            onChange={(event) => onLimitChange(Number(event.target.value))}
            className="h-8 cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface pr-7 pl-2.5 text-small text-ink tabular-nums hover:bg-surface-hover"
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            strokeWidth={1.5}
            className="pointer-events-none absolute right-1.5 size-4 text-ink-muted"
          />
        </span>
        {t('pagination.perPageAfter')}
      </label>
      <span className="grow text-small text-ink-muted">{summary}</span>
      <nav aria-label={t('pagination.label')} className="flex items-center gap-1">
        <Button
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-2"
        >
          <ChevronLeft aria-hidden strokeWidth={1.5} />
          {t('pagination.previous')}
        </Button>
        {pageItems(page, totalPages).map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden
              className="min-w-6 text-center text-small text-ink-muted"
            >
              …
            </span>
          ) : (
            <Button
              key={item}
              size="sm"
              variant={item === page ? 'primary' : 'ghost'}
              aria-current={item === page ? 'page' : undefined}
              aria-label={t('pagination.page', { page: item })}
              onClick={() => onPageChange(item)}
              className={cn('min-w-8 px-2 tabular-nums')}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-2"
        >
          {t('pagination.next')}
          <ChevronRight aria-hidden strokeWidth={1.5} />
        </Button>
      </nav>
    </div>
  );
}
