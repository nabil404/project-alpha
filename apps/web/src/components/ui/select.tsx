import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

export interface SelectOption {
  /** An empty string is allowed: "All categories", "No area". */
  value: string;
  label: string;
}

/** Radix rejects an item whose value is "", so the empty choice travels as this. */
const EMPTY = '__empty__';
const toRadix = (value: string) => (value === '' ? EMPTY : value);
const fromRadix = (value: string) => (value === EMPTY ? '' : value);

type SelectProps = Omit<React.ComponentProps<'button'>, 'value' | 'onChange' | 'children'> & {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** `sm` is the h-8 control for toolbars and table footers. */
  size?: 'default' | 'sm';
  /** Shown before the value in the trigger: a theme icon. */
  icon?: React.ReactNode;
  /** Classes for the list, e.g. a wider list than the trigger. */
  contentClassName?: string;
};

/**
 * A select for short lists (about ten or fewer; longer ones want the
 * searchable Combobox). Data in through props, the choice out through
 * `onValueChange`; the trigger takes the id and aria attributes a FormControl
 * gives it, and `name`/`onBlur` from react-hook-form's `field`.
 */
function Select({
  value,
  onValueChange,
  options,
  placeholder,
  size = 'default',
  icon,
  contentClassName,
  className,
  disabled,
  ...props
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={toRadix(value)}
      onValueChange={(next) => onValueChange(fromRadix(next))}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        data-size={size}
        className={cn(
          'flex w-full min-w-0 cursor-pointer items-center gap-2 border border-border-strong bg-surface text-left text-ink transition-colors duration-[120ms] hover:bg-surface-hover',
          'data-[size=default]:h-10 data-[size=default]:rounded-md data-[size=default]:px-4 data-[size=default]:text-body',
          'data-[size=sm]:h-8 data-[size=sm]:rounded-md data-[size=sm]:px-3 data-[size=sm]:text-label',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled',
          'aria-invalid:border-danger data-placeholder:text-ink-muted',
          className,
        )}
        {...props}
      >
        {icon}
        <span className="min-w-0 grow truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-ink-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          data-slot="select-content"
          position="popper"
          align="start"
          sideOffset={4}
          collisionPadding={16}
          className={cn(
            'z-50 max-h-(--radix-select-content-available-height) w-(--radix-select-trigger-width) min-w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-surface text-ink shadow-popover',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200',
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="max-h-72 p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={toRadix(option.value)}
                data-slot="select-item"
                className={cn(
                  'relative flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-body outline-hidden select-none',
                  'data-highlighted:bg-surface-hover data-disabled:cursor-not-allowed data-disabled:text-ink-disabled',
                )}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-auto">
                  <Check aria-hidden strokeWidth={1.5} className="size-4 text-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/**
 * Maps a react-hook-form `field` onto Select's props: `<Select {...fieldProps(field)} />`.
 * Structural, so this file stays free of react-hook-form.
 */
function fieldProps(field: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  name: string;
  ref: React.Ref<HTMLButtonElement>;
}) {
  return {
    value: field.value,
    onValueChange: field.onChange,
    onBlur: field.onBlur,
    name: field.name,
    ref: field.ref,
  };
}

export { Select, fieldProps };
