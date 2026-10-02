# Design system

The seller dashboard (`apps/web`) is a calm, rounded admin panel: titles lead,
body copy follows, and nothing competes with the seller's orders.

- **Live reference** (previews of every component in each theme):
  [Social Glider design system](https://claude.ai/artifact/9SnvbLDLkpRqKURDoLnpfm)
- **Source of truth in code:** [`apps/web/src/index.css`](../apps/web/src/index.css)
  — every token below is defined there. If this document and `index.css`
  disagree, `index.css` wins; fix this document.

## Principles

- **Quiet by default.** One hue, `accent` (a calm teal), used sparingly: the
  primary action, the active nav item, links and focus. Everything else is ink
  on neutral surfaces. Status colours appear only inside badges and banners,
  always with a word.
- **Titles lead, body follows.** A screen reads top-down: `text-display` page
  title → `text-title` sections → `text-heading` cards → `text-body`. Titles are
  `text-ink` at weight 600; descriptions under a title are `text-ink-muted`.
  Never skip a step or set two title sizes side by side.
- **Room to breathe.** 24px inside cards and between them, 32px page gutters,
  48px between page sections. When a screen feels crowded, remove content before
  reducing spacing.
- **Soft edges.** Every surface is rounded; an element nested inside another
  uses the next radius down.

## Themes

The system supports any number of themes, not just a light/dark pair. Two ship
today: **Light** (default) and **Dark**.

- Code uses **semantic tokens only** (`bg-surface`, `text-ink-muted`,
  `bg-accent-soft` …) — never a palette colour (`slate-*`, `white`, a hex) and
  **never a `dark:` variant**. A theme swaps the values behind the same names.
- The active theme is `data-theme` on `<html>`. `useThemePreference()` in
  `apps/web/src/lib/theme.ts` sets it (via `ThemeSelect` in the header), and an
  inline script in `apps/web/index.html` sets it before first paint. The default
  preference is **System**, which follows the OS and tracks changes; an explicit
  Light or Dark choice is stored under the `app.theme` localStorage key.

### Adding a theme

1. Add a `[data-theme='<id>']` block to `apps/web/src/index.css` with a value
   for **every** colour token and both elevation variables.
2. Add the id to `THEMES` in `apps/web/src/lib/theme.ts` and to the `themes`
   array in the `index.html` script.
3. Add a `theme.<id>` label to `apps/web/src/i18n/locales/en/common.json` and
   to `themeLabelKeys` in `ThemeSelect.tsx`.
4. Check the contrast pairs below in the new theme before shipping.

### Contrast every theme must keep

| Pair                                                                           | Minimum |
| ------------------------------------------------------------------------------ | ------- |
| `ink`, `ink-muted` on `bg`, `surface`, `surface-sunken`, `surface-hover`       | 4.5:1   |
| `accent`, `success`, `warning`, `danger` on `surface` and on their own `-soft` | 4.5:1   |
| `on-accent` on `accent` and `accent-hover`                                     | 4.5:1   |
| `border-strong`, `focus-ring` on `surface` and `bg`                            | 3:1     |

A theme that lightens the accent (every dark theme) needs dark `on-accent`
text — never hard-code white on an accent fill.

## Colour tokens

Tailwind utilities are `bg-<token>`, `text-<token>`, `border-<token>`
(`border-border`, `border-border-strong`), `ring-<token>`, and so on.

| Token                      | Light                 | Dark                  | Use                                                         |
| -------------------------- | --------------------- | --------------------- | ----------------------------------------------------------- |
| `bg`                       | `#f5f5f2`             | `#131416`             | App shell, the gaps between cards                           |
| `surface`                  | `#ffffff`             | `#1b1c1f`             | Cards, tables, sidebar, menus, inputs                       |
| `surface-sunken`           | `#efefeb`             | `#161719`             | Table header rows, switch track, read-only wells            |
| `surface-hover`            | `#e9e9e4`             | `#25272b`             | Hovered/selected rows, ghost buttons, nav items             |
| `border`                   | `#e2e2dc`             | `#2c2e33`             | Decorative hairlines: card outlines, row dividers           |
| `border-strong`            | `#8c8c84`             | `#6e7179`             | Edges of controls: inputs, selects, secondary buttons       |
| `ink`                      | `#1b1c1e`             | `#ececea`             | Titles, body copy, table values                             |
| `ink-muted`                | `#5c5e63`             | `#a2a4aa`             | Descriptions, metadata, hints, placeholders, column headers |
| `ink-disabled`             | `#a4a59f`             | `#5b5d63`             | Disabled labels only                                        |
| `accent`                   | `#1f6b70`             | `#7fcacd`             | Primary button, links, active nav, focus ring               |
| `accent-hover`             | `#185a5e`             | `#9ad8da`             | Primary button hover/pressed                                |
| `accent-soft`              | `#e6f1f1`             | `#17302f`             | Active nav item, "New" badge, selected row                  |
| `on-accent`                | `#ffffff`             | `#131416`             | Text and icons on an accent fill                            |
| `success` / `success-soft` | `#2d6b4a` / `#e7f3ec` | `#86cfa3` / `#1b3326` | Delivered, in stock, saved                                  |
| `warning` / `warning-soft` | `#855410` / `#f8efe0` | `#e4b56e` / `#3a2c14` | Awaiting confirmation, handed off                           |
| `danger` / `danger-soft`   | `#a93b36` / `#f8e9e7` | `#f0a097` / `#3d201e` | Cancelled, destructive actions, field errors                |
| `focus-ring`               | = `accent`            | = `accent`            | 2px focus outline (applied globally)                        |
| `link`                     | = `accent`            | = `accent`            | Inline links                                                |
| `overlay`                  | black-ish 40%         | black 60%             | Scrim behind dialogs and the mobile drawer                  |
| `viewer` / `on-viewer`     | `#141517` / `#ffffff` | same as Light         | Full-screen photo viewer, dark in every theme               |
| `on-viewer-muted`          | `#a4a59f`             | same as Light         | Secondary text in the photo viewer                          |

## Type

Figtree for everything; JetBrains Mono for order numbers and IDs. Each size
utility carries its own line height, weight and tracking — don't add
`leading-*` or `font-semibold` next to it.

| Utility               | Size / line | Weight | Use                                                                             |
| --------------------- | ----------- | ------ | ------------------------------------------------------------------------------- |
| `text-display`        | 30 / 38     | 600    | Page title, once per screen                                                     |
| `text-title`          | 21 / 28     | 600    | Section and dialog titles                                                       |
| `text-heading`        | 16 / 24     | 600    | Card and form-group titles                                                      |
| `text-stat`           | 28 / 36     | 600    | Dashboard figures (add `tabular-nums`)                                          |
| `text-body`           | 15 / 24     | 400    | Default copy, table cells, form values (`font-medium` for names, button labels) |
| `text-small`          | 13 / 20     | 400    | Metadata, hints, timestamps                                                     |
| `text-label`          | 13 / 18     | 500    | Form labels, column headers, badges                                             |
| `font-mono text-code` | 13 / 20     | 400    | Order numbers, IDs                                                              |

- Sentence case everywhere, including buttons and titles. No all-caps labels.
- Money and counts use `tabular-nums` and are right-aligned in tables. Money is
  always formatted with `useFormatters().formatMoney` — never by hand.

## Spacing, radius, depth

Spacing uses Tailwind's default 4px steps.

| Where                               | Value                     | Classes              |
| ----------------------------------- | ------------------------- | -------------------- |
| Inside a card; between cards        | 24px                      | `p-6`, `gap-6`       |
| Page gutters                        | 16px mobile, 32px desktop | `px-4 sm:px-8`       |
| Between page sections               | 48px                      | `gap-12` / `mt-12`   |
| Page header → content               | 32px                      | `mb-8`               |
| Between fields; control padding     | 16px                      | `gap-4`, `px-4`      |
| Between buttons; table cell padding | 12px × 16px               | `gap-3`, `py-3 px-4` |
| Controls                            | 40px tall (32px small)    | `h-10` / `h-8`       |

| Radius         | Value | Use                                 |
| -------------- | ----- | ----------------------------------- |
| `rounded-sm`   | 6px   | Checkboxes, tooltips, small chips   |
| `rounded-md`   | 10px  | Buttons, inputs, selects, nav items |
| `rounded-lg`   | 16px  | Cards, tables, popovers             |
| `rounded-xl`   | 22px  | Dialogs, drawers                    |
| `rounded-full` | —     | Badges, switches, avatars           |

Separation comes mostly from `border` hairlines and the step from `bg` to
`surface`. Use `shadow-card` under resting cards and tables and
`shadow-popover` for menus, popovers and dialogs. Motion is quiet: colour
changes ~120ms, fades ~200ms, no bounces or slides.

## States

- **Hover:** `hover:bg-surface-hover` on neutral things, `hover:bg-accent-hover`
  on the primary button.
- **Focus:** a solid 2px `focus-ring` outline, offset 2px — set globally for
  `:focus-visible`; don't remove it.
- **Disabled:** `text-ink-disabled` on `bg-surface-sunken`,
  `disabled:cursor-not-allowed`.
- **Clickable:** every clickable primitive sets `cursor-pointer`.

## Components

| Component   | Rules                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button      | `primary` (accent fill, `on-accent` label) at most once per view, last in its row; `secondary` (surface, `border-strong`) is the default; `ghost` in toolbars and rows; `danger` (danger text) for destructive actions, always confirmed. Order-status buttons are gated by `canTransitionOrder`. |
| Badge       | Pill, `text-label`, a dot plus a word. Labels from `useStatusLabels()`.                                                                                                                                                                                                                           |
| Card        | `bg-surface border border-border rounded-lg shadow-card p-6`; `text-heading` title, optional `text-small text-ink-muted` description, actions top-right. No card inside a card; no coloured left borders.                                                                                         |
| Page header | `text-display` title, one `text-body text-ink-muted` line, actions on the right.                                                                                                                                                                                                                  |
| Field       | `text-label` label 8px above a 40px input with `border-border-strong`; hint `text-small text-ink-muted`; error replaces the hint in `text-danger` and sets `aria-invalid`.                                                                                                                        |
| Switch      | Immediate on/off settings (bot on/off). On: accent track, `on-accent` thumb. Not inside forms with a Save button.                                                                                                                                                                                 |
| Table       | Rounded `surface` wrapper; header row `bg-surface-sunken text-label text-ink-muted`; rows divided by `border`, hover `surface-hover`; IDs in mono, money right-aligned. No zebra stripes.                                                                                                         |
| Stat card   | `text-small` label, `text-stat tabular-nums` figure, `text-small` note. Three or four per row; the figure is never coloured.                                                                                                                                                                      |

### Status badge tones

Map status → tone in one place, next to `apps/web/src/i18n/status-keys.ts`, so a
new enum member fails the build instead of rendering unstyled.

| Status                                             | Tone                         |
| -------------------------------------------------- | ---------------------------- |
| Order `new`                                        | accent — it needs the seller |
| Order `confirmed`, `packed`, `shipped`             | neutral                      |
| Order `delivered`, stock `in_stock`                | success                      |
| Order `cancelled`, stock `out_of_stock`            | danger                       |
| Conversation `awaiting_confirmation`, `handed_off` | warning                      |
| Conversation `abandoned`                           | neutral                      |
| Product `active` (Published)                       | success                      |
| Product `draft`, `archived`                        | neutral                      |

Keep `accent` for the one status that needs the seller: the teal accent sits
near `success` in hue, so an accent badge must never be the only thing that
tells it apart from Delivered.

## Voice

Plain and short, spoken to the seller as "you". Name the thing, not the system:
"Rahim confirmed the order", "3 orders need confirming", "Couldn't save. Try
again." No exclamation marks, no emoji in the UI.

## Icons

Lucide (`lucide-react`) at 16px in buttons and badges, 20px in navigation,
1.5px stroke, coloured like the text beside it. Icons accompany words; an
icon-only button needs an `aria-label` and a tooltip.
