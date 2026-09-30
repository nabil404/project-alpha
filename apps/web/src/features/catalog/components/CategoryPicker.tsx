import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { toCategoryEntries, type CategoryEntry } from '../category-entries';
import { useCategories } from '../queries';

interface CategoryPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  labelId: string;
}

/** The product's categories as a list, and a combobox to add another. */
export function CategoryPicker({ value, onChange, labelId }: CategoryPickerProps) {
  const { t } = useTranslation('catalog');
  const categories = useCategories();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const entries = useMemo(() => toCategoryEntries(categories.data ?? []), [categories.data]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const selected = value.map((id) => byId.get(id)).filter((e) => e !== undefined);

  const needle = query.trim().toLowerCase();
  const matches = entries.filter(
    (e) =>
      !value.includes(e.id) &&
      (!needle || e.name.toLowerCase().includes(needle) || e.path.toLowerCase().includes(needle)),
  );
  const expanded = open && categories.isSuccess;

  const pick = (entry: CategoryEntry) => {
    onChange([...value, entry.id]);
    setQuery('');
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && expanded && matches[active]) {
      // Enter picks; it must not submit the product form.
      event.preventDefault();
      pick(matches[active]);
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {selected.length > 0 && (
        <ul aria-label={t('organisation.selected')} className="flex flex-col gap-1.5">
          {selected.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 rounded-md border border-accent bg-accent-soft py-1.5 pr-1 pl-3"
            >
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-body font-medium">{entry.name}</span>
                {entry.path && (
                  <span className="truncate text-small text-ink-muted">{entry.path}</span>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-ink-muted"
                aria-label={t('organisation.remove', { name: entry.name })}
                onClick={() => onChange(value.filter((id) => id !== entry.id))}
              >
                <X aria-hidden strokeWidth={1.5} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-3 left-3 size-4 text-ink-muted"
          strokeWidth={1.5}
        />
        <Input
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && matches[active] ? `${listId}-${active}` : undefined}
          placeholder={t('organisation.addCategory')}
          className="pl-9"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {expanded && (
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-popover"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-small text-ink-muted">
                {entries.length === 0 ? t('organisation.noCategories') : t('organisation.noMatch')}
              </li>
            ) : (
              matches.map((entry, index) => (
                <li
                  key={entry.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={cn(
                    'flex cursor-pointer flex-col rounded-md px-3 py-2',
                    index === active && 'bg-surface-hover',
                  )}
                  // Before the input's blur closes the list.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(entry);
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  <span className="text-body">{entry.name}</span>
                  {entry.path && <span className="text-small text-ink-muted">{entry.path}</span>}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <p className="text-small text-ink-muted">{t('organisation.categoriesHint')}</p>
      {categories.isError && (
        <p className="text-small text-danger">{t('organisation.loadFailed')}</p>
      )}
    </div>
  );
}
