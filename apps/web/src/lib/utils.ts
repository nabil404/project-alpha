import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's default scales. The type scale in
 * index.css (`text-body`, `text-label` …) is custom, and unregistered it reads
 * as a text colour: `cn('text-label text-ink', 'text-body')` would drop
 * `text-ink` and keep both sizes. Keep this list in step with the
 * `--text-*` tokens there.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'title', 'heading', 'stat', 'body', 'small', 'label', 'code'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
