import * as Flags from 'country-flag-icons/react/3x2';

import { cn } from '@/lib/utils';

const flags: Record<string, (props: { className?: string }) => React.JSX.Element> = Flags;

/**
 * A country's flag as an SVG. Emoji flags show as two letters on Windows, so
 * they can't be relied on. Decorative: the country's name sits beside it.
 */
export function Flag({ country, className }: { country: string; className?: string }) {
  const Svg = flags[country];
  return Svg ? <Svg className={cn('h-4 w-6 shrink-0 rounded-[2px]', className)} /> : null;
}
