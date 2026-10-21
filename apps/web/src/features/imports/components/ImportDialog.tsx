import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { addDays, format, parseISO, subMonths, subYears } from 'date-fns';
import { ChevronRight, FileSpreadsheet, FileText, Image, Images, Package, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { IMPORT_RANGE_MAX_DAYS, importRangeDays, shopToday } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFacebookPage } from '@/features/messenger/queries';
import { useErrorMessages } from '@/i18n/error-keys';
import { useShopRegion } from '@/lib/shop-region';
import { cn } from '@/lib/utils';

import { useFacebookImportAccess, useStartImport } from '../queries';

export type ImportStep = 'source' | 'dates';

type Preset = 'lastMonth' | 'lastMonths3' | 'lastMonths6' | 'lastYear' | 'custom';

/** Each preset ends today and starts the day after the same date that many months back. */
const PRESETS = {
  lastMonth: (today: Date) => addDays(subMonths(today, 1), 1),
  lastMonths3: (today: Date) => addDays(subMonths(today, 3), 1),
  lastMonths6: (today: Date) => addDays(subMonths(today, 6), 1),
  lastYear: (today: Date) => addDays(subYears(today, 1), 1),
} as const satisfies Record<Exclude<Preset, 'custom'>, (today: Date) => Date>;

const presets = [...(Object.keys(PRESETS) as (keyof typeof PRESETS)[]), 'custom'] as const;

const day = (date: Date) => format(date, 'yyyy-MM-dd');

/** What is wrong with a range, before the API is asked. */
function rangeProblem(since: string, until: string, today: string): ParseKeys<'catalog'> | null {
  if (!since || !until) return null;
  if (until > today) return 'imports.dialog.range.future';
  const days = importRangeDays(since, until);
  if (days < 1) return 'imports.dialog.range.order';
  if (days > IMPORT_RANGE_MAX_DAYS) return 'imports.dialog.range.tooLong';
  return null;
}

/** "Rahim's Kitchen" → "RK". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');

/**
 * Catalog's Import: the source to import from, then the dates of the Page's
 * posts to read. Starting the run opens its page.
 */
export function ImportDialog({
  open,
  onOpenChange,
  step: initialStep,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: ImportStep;
}) {
  const [step, setStep] = useState(initialStep);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setStep(initialStep);
      }}
    >
      <DialogContent className={cn('gap-0 p-0', step === 'source' ? 'max-w-[35rem]' : 'max-w-2xl')}>
        {step === 'source' ? (
          <SourceStep onFacebook={() => setStep('dates')} />
        ) : (
          <DatesStep onStarted={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DialogHead({ title, description }: { title: string; description: string }) {
  const { t } = useTranslation('catalog');

  return (
    <div className="flex items-start gap-3">
      <div className="flex grow flex-col gap-0.5">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-small">{description}</DialogDescription>
      </div>
      <DialogClose asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('imports.dialog.close')}>
          <X aria-hidden strokeWidth={1.5} className="size-5" />
        </Button>
      </DialogClose>
    </div>
  );
}

function SourceStep({ onFacebook }: { onFacebook: () => void }) {
  const { t } = useTranslation(['catalog', 'common']);
  const option = 'flex w-full items-center gap-4 rounded-lg border p-4 text-left';
  const tile = 'flex size-11 shrink-0 items-center justify-center rounded-md';

  return (
    <>
      <div className="flex flex-col gap-5 p-6">
        <DialogHead
          title={t('imports.dialog.sourceTitle')}
          description={t('imports.dialog.sourceDescription')}
        />
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onFacebook}
            className={cn(
              option,
              'cursor-pointer border-border-strong bg-surface transition-colors duration-[120ms] hover:border-accent hover:bg-surface-hover',
            )}
          >
            <span className={cn(tile, 'bg-accent-soft text-accent')}>
              <Images aria-hidden strokeWidth={1.5} className="size-[22px]" />
            </span>
            <span className="flex grow flex-col">
              <span className="text-body font-semibold">{t('imports.dialog.facebook')}</span>
              <span className="text-small text-ink-muted">{t('imports.dialog.facebookHint')}</span>
            </span>
            <ChevronRight aria-hidden strokeWidth={1.5} className="size-5 text-ink-muted" />
          </button>
          <button
            type="button"
            disabled
            className={cn(option, 'cursor-not-allowed border-border bg-bg text-ink-disabled')}
          >
            <span className={cn(tile, 'bg-surface-sunken')}>
              <FileSpreadsheet aria-hidden strokeWidth={1.5} className="size-[22px]" />
            </span>
            <span className="flex grow flex-col">
              <span className="text-body font-semibold">{t('imports.dialog.csv')}</span>
              <span className="text-small">{t('imports.dialog.csvHint')}</span>
            </span>
            <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-surface-sunken px-2.5 text-label whitespace-nowrap text-ink-muted">
              {t('imports.dialog.comingSoon')}
            </span>
          </button>
        </div>
      </div>
      <div className="flex justify-end border-t border-border px-6 py-4">
        <DialogClose asChild>
          <Button>{t('common:actions.cancel')}</Button>
        </DialogClose>
      </div>
    </>
  );
}

function DatesStep({ onStarted }: { onStarted: () => void }) {
  const { t } = useTranslation(['catalog', 'common']);
  const { forError } = useErrorMessages();
  const navigate = useNavigate();
  const { timeZone } = useShopRegion();
  const page = useFacebookPage();
  const connected = Boolean(page.data?.page);
  const access = useFacebookImportAccess(connected);
  const start = useStartImport();
  const id = useId();

  const today = shopToday(timeZone);
  const presetRange = (preset: Exclude<Preset, 'custom'>) => ({
    since: day(PRESETS[preset](parseISO(today))),
    until: today,
  });
  const [preset, setPreset] = useState<Preset>('lastMonths3');
  const [range, setRange] = useState(() => presetRange('lastMonths3'));

  const problem = rangeProblem(range.since, range.until, today);
  const complete = Boolean(range.since && range.until) && !problem;
  const checking = page.isPending || (connected && access.isPending);
  const blocked = !connected || access.data?.canReadPosts === false;
  // Neither we nor Facebook could say whether the posts can be read: nothing to start.
  const unreachable = page.isError || access.isError;
  const pageName = page.data?.page?.name ?? '';

  const pick = (next: Preset) => {
    setPreset(next);
    if (next !== 'custom') setRange(presetRange(next));
  };
  // Typing a date makes the range the seller's own.
  const edit = (change: Partial<typeof range>) => {
    setPreset('custom');
    setRange({ ...range, ...change });
  };

  const submit = () =>
    start.mutate(
      { source: 'facebook_posts', ...range },
      {
        onSuccess: (run) => {
          onStarted();
          void navigate({ to: '/catalog/imports/$importId', params: { importId: run.id } });
        },
      },
    );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <DialogHead
          title={t('imports.dialog.datesTitle')}
          description={t('imports.dialog.datesDescription')}
        />

        {start.isError && <ErrorBanner>{forError(start.error)}</ErrorBanner>}
        {unreachable && (
          <div className="flex flex-col items-start gap-3">
            <ErrorBanner className="self-stretch">
              {forError(page.isError ? page.error : access.error)}
            </ErrorBanner>
            <Button
              type="button"
              size="sm"
              onClick={() => void (page.isError ? page.refetch() : access.refetch())}
            >
              {t('common:actions.retry')}
            </Button>
          </div>
        )}

        {unreachable ? null : checking ? (
          <p className="text-body text-ink-muted">{t('imports.dialog.checking')}</p>
        ) : !connected ? (
          <p className="rounded-md bg-warning-soft px-4 py-3 text-body text-ink">
            {t('imports.dialog.connectFirst')}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-label text-accent"
              >
                {initials(pageName)}
              </span>
              <span className="flex min-w-0 grow flex-col">
                <span className="text-small text-ink-muted">{t('imports.dialog.pageLabel')}</span>
                <span className="truncate text-body font-medium">{pageName}</span>
              </span>
              <span className="text-small text-ink-muted max-sm:hidden">
                {t('imports.dialog.pageHint')}
              </span>
            </div>

            {access.data?.canReadPosts === false ? (
              <p className="rounded-md bg-warning-soft px-4 py-3 text-body text-ink">
                {t('imports.dialog.reconnectHint')}
              </p>
            ) : (
              <>
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-3 text-body font-semibold">
                    {t('imports.dialog.presets.label')}
                  </legend>
                  <div
                    role="radiogroup"
                    aria-label={t('imports.dialog.presets.groupLabel')}
                    className="flex flex-wrap gap-2"
                  >
                    {presets.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={preset === option}
                        onClick={() => pick(option)}
                        className={cn(
                          'h-9 cursor-pointer rounded-full border px-3.5 text-label transition-colors duration-[120ms]',
                          preset === option
                            ? 'border-accent bg-accent-soft text-accent'
                            : 'border-border bg-surface text-ink hover:bg-surface-hover',
                        )}
                      >
                        {t(`imports.dialog.presets.${option}`)}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Label htmlFor={`${id}-since`}>{t('imports.dialog.range.since')}</Label>
                      <Input
                        id={`${id}-since`}
                        type="date"
                        max={today}
                        value={range.since}
                        aria-invalid={problem === 'imports.dialog.range.order' || undefined}
                        onChange={(event) => edit({ since: event.target.value })}
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Label htmlFor={`${id}-until`}>{t('imports.dialog.range.until')}</Label>
                      <Input
                        id={`${id}-until`}
                        type="date"
                        max={today}
                        value={range.until}
                        aria-invalid={problem === 'imports.dialog.range.future' || undefined}
                        onChange={(event) => edit({ until: event.target.value })}
                      />
                    </div>
                  </div>
                  {problem ? (
                    <p className="text-small text-danger">{t(problem)}</p>
                  ) : (
                    <p className="text-small text-ink-muted">{t('imports.dialog.rangeNote')}</p>
                  )}
                </fieldset>

                <div className="flex flex-col gap-3">
                  <h3 className="text-body font-semibold">
                    {t('imports.dialog.whatHappens.title')}
                  </h3>
                  <ul className="flex flex-col gap-2.5 text-body">
                    <Step icon={<FileText />}>{t('imports.dialog.whatHappens.read')}</Step>
                    <Step icon={<Package />}>{t('imports.dialog.whatHappens.drafts')}</Step>
                    <Step icon={<Image />}>{t('imports.dialog.whatHappens.photos')}</Step>
                  </ul>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-4">
        <span className="grow text-small text-ink-muted">{t('imports.dialog.footerNote')}</span>
        <DialogClose asChild>
          <Button type="button">{t('common:actions.cancel')}</Button>
        </DialogClose>
        {!checking && !unreachable && blocked ? (
          <Button asChild variant="primary">
            <Link to="/settings/messenger" onClick={onStarted}>
              {connected ? t('imports.dialog.reconnect') : t('imports.dialog.connectPage')}
            </Link>
          </Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            disabled={checking || unreachable || !complete || start.isPending}
          >
            {start.isPending ? t('imports.dialog.starting') : t('imports.dialog.start')}
          </Button>
        )}
      </div>
    </form>
  );
}

function Step({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex pt-0.5 text-accent [&_svg]:size-5 [&_svg]:stroke-[1.5]">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}
