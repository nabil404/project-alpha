/** An ILIKE pattern matching `term` literally anywhere: `%`, `_` and `\` lose their meaning. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
