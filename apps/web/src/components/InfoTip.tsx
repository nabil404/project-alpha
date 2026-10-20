import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const CLOSE_DELAY_MS = 150;

/**
 * An info icon whose note opens on hover, keyboard focus or a tap. A popover
 * rather than a tooltip, because a tooltip never opens on a phone.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Opened by hovering or tabbing in: the next click keeps it open instead of toggling.
  const softOpen = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const openSoftly = () => {
    window.clearTimeout(closeTimer.current);
    if (!open) {
      softOpen.current = true;
      setOpen(true);
    }
  };
  const closeSoon = () => {
    if (!softOpen.current) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      softOpen.current = false;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  };
  const onMouse = (handler: () => void) => (event: PointerEvent) => {
    if (event.pointerType === 'mouse') handler();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        softOpen.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger
        aria-label={label}
        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink data-[state=open]:text-ink"
        onPointerEnter={onMouse(openSoftly)}
        onPointerLeave={onMouse(closeSoon)}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) openSoftly();
        }}
        onClick={(event) => {
          if (softOpen.current) {
            event.preventDefault();
            softOpen.current = false;
          }
        }}
      >
        <Info aria-hidden className="size-[18px]" strokeWidth={1.5} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 text-small"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={onMouse(() => window.clearTimeout(closeTimer.current))}
        onPointerLeave={onMouse(closeSoon)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
