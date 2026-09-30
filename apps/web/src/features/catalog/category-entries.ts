import type { Category } from '@app/shared';

export interface CategoryEntry {
  id: string;
  name: string;
  /** Its ancestors, "Women › Kurtis"; empty for a root. */
  path: string;
}

/** Every category with its ancestors' names, sorted as the tree reads. */
export function toCategoryEntries(categories: Category[]): CategoryEntry[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const ancestors = (category: Category): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    let parent = category.parentId ? byId.get(category.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(parent.name);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return names;
  };

  return categories
    .map((c) => ({ id: c.id, name: c.name, path: ancestors(c).join(' › ') }))
    .sort((a, b) =>
      `${a.path} ${a.name}`.localeCompare(`${b.path} ${b.name}`, undefined, {
        sensitivity: 'base',
      }),
    );
}
