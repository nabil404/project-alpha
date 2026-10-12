/**
 * Which Products columns show at each width of the table's card, not the
 * window, since the sidebar takes part of it. Columns have fixed widths and
 * drop out as the card narrows. Product takes what is left, and Product, Price
 * and Stock always show. `cell` is for header, body and placeholder cells, and
 * `col` for the sizing `<col>`, so a hidden column frees its width.
 */
export const productColumns = {
  category: { cell: 'hidden @4xl:table-cell', col: 'hidden w-40 @4xl:table-column' },
  variants: { cell: 'hidden @5xl:table-cell', col: 'hidden w-22 @5xl:table-column' },
  options: { cell: 'hidden @5xl:table-cell', col: 'hidden w-28 @5xl:table-column' },
  status: { cell: 'hidden @2xl:table-cell', col: 'hidden w-28 @2xl:table-column' },
} as const;
