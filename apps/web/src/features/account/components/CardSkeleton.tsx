/** A settings card's shape while its query loads; the same one SignInMethodsCard shows. */
export function CardSkeleton() {
  return <div aria-busy className="h-64 rounded-lg border border-border bg-surface shadow-card" />;
}
