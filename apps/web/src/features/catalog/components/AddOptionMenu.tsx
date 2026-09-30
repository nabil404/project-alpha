import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRODUCT_OPTION_MAX_COUNT } from '@app/shared';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { sameText } from '../options';

/** Common options, offered by name; the seller types their own values. */
const SUGGESTIONS = ['size', 'colour', 'fabric', 'length', 'packSize'] as const;

interface AddOptionMenuProps {
  /** The product's current option names. */
  taken: string[];
  onChoose: (name: string) => void;
}

export function AddOptionMenu({ taken, onChoose }: AddOptionMenuProps) {
  const { t } = useTranslation('catalog');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const full = taken.length >= PRODUCT_OPTION_MAX_COUNT;

  const needle = query.trim();
  const suggestions = SUGGESTIONS.map((key) => ({
    key,
    name: t(`options.suggestions.${key}.name`),
    examples: t(`options.suggestions.${key}.examples`),
  })).filter((s) => !needle || s.name.toLowerCase().includes(needle.toLowerCase()));
  const exact = suggestions.some((s) => sameText(s.name, needle));

  const choose = (name: string) => {
    setOpen(false);
    setQuery('');
    onChoose(name);
  };

  const item =
    'flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-surface-hover disabled:cursor-not-allowed disabled:hover:bg-transparent';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          className="border-accent text-accent"
          disabled={full}
          title={full ? t('options.limit', { max: PRODUCT_OPTION_MAX_COUNT }) : undefined}
        >
          <Plus aria-hidden strokeWidth={1.5} />
          {t('options.addOption')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-1 p-2">
        <div className="relative mb-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-3 left-3 size-4 text-ink-muted"
            strokeWidth={1.5}
          />
          <input
            type="search"
            aria-label={t('options.search')}
            placeholder={t('options.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (needle && !taken.some((name) => sameText(name, needle))) choose(needle);
              }
            }}
            className="h-10 w-full rounded-md border border-border-strong bg-surface pr-3 pl-9 text-body text-ink placeholder:text-ink-muted"
          />
        </div>

        {suggestions.length > 0 && (
          <span className="px-3 pt-1 text-label text-ink-muted">{t('options.suggested')}</span>
        )}
        {suggestions.map((s) => {
          const added = taken.some((name) => sameText(name, s.name));
          return (
            <button
              key={s.key}
              type="button"
              className={item}
              disabled={added}
              onClick={() => choose(s.name)}
            >
              <span className="flex min-w-0 grow flex-col">
                <span className={cn('text-body', added && 'text-ink-disabled')}>{s.name}</span>
                <span className="truncate text-small text-ink-muted">{s.examples}</span>
              </span>
              {added && <span className="text-label text-ink-muted">{t('options.added')}</span>}
            </button>
          );
        })}

        <div className="my-1 h-px bg-border" />
        <button
          type="button"
          className={cn(item, 'font-medium text-accent')}
          onClick={() => choose(needle && !exact ? needle : '')}
        >
          <Plus aria-hidden className="size-4" strokeWidth={1.5} />
          {needle && !exact ? t('options.createNamed', { name: needle }) : t('options.create')}
        </button>
        <p className="px-3 pt-1 pb-1 text-small text-ink-muted">
          {t('options.menuHint', { max: PRODUCT_OPTION_MAX_COUNT })}
        </p>
      </PopoverContent>
    </Popover>
  );
}
