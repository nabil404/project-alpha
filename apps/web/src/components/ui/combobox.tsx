import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Shown before the label, in the list and the trigger: a flag. */
  prefix?: string;
  /** Other words the search matches: codes, aliases. */
  keywords?: string[];
  /** What the closed trigger shows instead of the label ("+880"). */
  display?: string;
}

export interface ComboboxGroup {
  heading?: string;
  options: ComboboxOption[];
}

type ComboboxProps = Omit<React.ComponentProps<'button'>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** One list, or several under headings. */
  options: ComboboxOption[] | ComboboxGroup[];
  searchPlaceholder: string;
  emptyText: string;
  placeholder?: string;
  /** Classes for the popover, e.g. a wider list than the trigger. */
  contentClassName?: string;
};

/**
 * Every typed word must appear in the option's label, value or keywords.
 * cmdk's default fuzzy match would let "kolkata" find "North Dakota", which
 * in a list of 300 zones buries the one meant.
 */
function containsEveryWord(value: string, search: string, keywords?: string[]): number {
  const haystack = [value, ...(keywords ?? [])].join(' ').toLocaleLowerCase();
  return search
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word))
    ? 1
    : 0;
}

function isGrouped(options: ComboboxOption[] | ComboboxGroup[]): options is ComboboxGroup[] {
  return options.length > 0 && 'options' in options[0]!;
}

/**
 * A select with a search box, for lists too long to scroll: countries, time
 * zones. Data in through props, the choice out through `onValueChange`; the
 * trigger takes the id and aria attributes a FormControl gives it.
 */
function Combobox({
  value,
  onValueChange,
  options,
  searchPlaceholder,
  emptyText,
  placeholder,
  contentClassName,
  className,
  disabled,
  ...props
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const groups = isGrouped(options) ? options : [{ options }];
  const selected = groups.flatMap((group) => group.options).find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'flex h-10 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-left text-body text-ink transition-colors duration-[120ms] hover:bg-surface-hover',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled',
            'aria-invalid:border-danger',
            className,
          )}
          {...props}
        >
          {selected?.prefix && <span aria-hidden>{selected.prefix}</span>}
          <span className={cn('min-w-0 grow truncate', !selected && 'text-ink-muted')}>
            {selected ? (selected.display ?? selected.label) : placeholder}
          </span>
          <ChevronDown aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-ink-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-(--radix-popover-trigger-width) min-w-64 p-0', contentClassName)}
      >
        <Command filter={containsEveryWord}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((group, index) => (
              <React.Fragment key={group.heading ?? index}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={group.heading}>
                  {group.options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label, ...(option.keywords ?? [])]}
                      onSelect={() => {
                        onValueChange(option.value);
                        setOpen(false);
                      }}
                    >
                      {option.prefix && <span aria-hidden>{option.prefix}</span>}
                      <span className="min-w-0 grow truncate">{option.label}</span>
                      <Check
                        aria-hidden
                        strokeWidth={1.5}
                        className={cn('text-accent', option.value !== value && 'invisible')}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </React.Fragment>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
