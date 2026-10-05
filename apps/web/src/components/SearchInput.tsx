import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * A list's search box. Typing updates the box at once and `onChange` (and so
 * the URL and the query) once the seller pauses.
 */
export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string | undefined;
  onChange: (q: string | undefined) => void;
  label: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value ?? '');

  // Back/forward changes the URL under the box.
  useEffect(() => setDraft(value ?? ''), [value]);

  useEffect(() => {
    const next = draft.trim() || undefined;
    if (next === value) return;
    const timer = setTimeout(() => onChange(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <div className="relative flex w-full items-center sm:w-80">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 size-4 text-ink-muted"
        strokeWidth={1.5}
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        maxLength={100}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="pl-9"
      />
    </div>
  );
}
