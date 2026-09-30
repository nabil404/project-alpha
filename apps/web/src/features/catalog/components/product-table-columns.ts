/**
 * Which Products columns show at which width of the table's card, not of the
 * window, since the sidebar takes a share of it. Every column keeps a fixed
 * width, so a row expanding never reflows the table; instead the less needed
 * columns drop out as the card narrows, and Product takes whatever is left.
 * Product, Price and Stock always show.
 *
 * Header cells, body cells and placeholders use `cell`; the `<col>` that sizes
 * each column uses `col`, so a hidden column gives its width back too.
 */
export const productColumns = {
  category: { cell: 'hidden @4xl:table-cell', col: 'hidden w-40 @4xl:table-column' },
  variants: { cell: 'hidden @5xl:table-cell', col: 'hidden w-22 @5xl:table-column' },
  options: { cell: 'hidden @5xl:table-cell', col: 'hidden w-28 @5xl:table-column' },
  status: { cell: 'hidden @2xl:table-cell', col: 'hidden w-28 @2xl:table-column' },
} as const;
