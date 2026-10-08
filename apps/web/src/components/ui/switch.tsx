import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * An on/off setting that applies at once - never inside a form with a Save
 * button (docs/DESIGN.md). On: accent track, on-accent thumb.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group/switch relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-[120ms]',
        'data-[state=unchecked]:border-border-strong data-[state=unchecked]:bg-surface-sunken',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-4 rounded-full transition-transform duration-200',
          'data-[state=unchecked]:translate-x-[3px] data-[state=unchecked]:bg-ink-muted',
          'data-[state=checked]:translate-x-[23px] data-[state=checked]:bg-on-accent',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
