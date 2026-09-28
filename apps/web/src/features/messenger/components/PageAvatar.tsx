/** The Page's initials; its Facebook picture would mean a request to Facebook from the dashboard. */
export function PageAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

  return (
    <span
      aria-hidden
      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-label text-accent"
    >
      {initials}
    </span>
  );
}
