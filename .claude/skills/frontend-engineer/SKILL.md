---
name: frontend-engineer
description: Frontend engineering conventions for apps/web, the seller dashboard of the Messenger-to-Order MVP (React 19, Vite, TanStack Router, TanStack Query, Tailwind v4, shadcn/ui, react-hook-form, Zod schemas from @app/shared). Use this skill for ANY work in apps/web — adding a page or route, building or editing a form, wiring a query or mutation, adding a shadcn component, rendering prices or order statuses, or writing a component test. Trigger it even when the user doesn't name the stack explicitly. Getting the data layer, the shared-schema rule, or money formatting wrong here duplicates validation that must stay in sync with the API, or does float math on currency, so consult this before writing code rather than after.
---

# Frontend Engineer

Frontend conventions for **`apps/web`**, the seller dashboard of the
Messenger-to-Order MVP. Stack is **React 19 · Vite · TypeScript · TanStack Router
· TanStack Query · Tailwind CSS v4 · shadcn/ui · react-hook-form + Zod**.

`AGENTS.md` at the repo root and the current MVP under `docs/mvp/` are the
project's source of truth. This skill is the frontend operating manual; where they
disagree, they win.

## Platform facts

- **This dashboard is for sellers only.** Customers never open it — they only
  ever talk to the Page in Messenger. Every screen here is something a seller
  does: watch orders arrive, fix them, manage the catalog, take over a chat.
- **Surfaces in scope** (`docs/mvp/01-messenger-to-order/scope.md`): orders list and detail with transcript,
  status changes, edits and notes, a Needs Attention queue, a conversation
  viewer, the bot on/off toggle, CSV import/export, catalog management, and Page
  connection. **Responsive is a requirement**, not a nice-to-have.
- **`src/` is still a scaffold** — `main.tsx`, `routes.tsx`, `index.css`,
  `lib/api.ts`, `lib/utils.ts`. Most of the structure below is what to create,
  not what to read. Sections that describe a convention ahead of the code say so
  explicitly.
- **One path alias: `@/*` → `./src/*`.** It is declared in **two** files that
  must be changed together — `resolve.alias` in `vite.config.ts` and `paths` in
  `tsconfig.json`. Changing one alone breaks either the build or the typecheck.
- `no-console` is an eslint warning with `warn`/`error` allowed
  (`eslint.config.js`). That rule exists because tokens must never reach logs —
  see Security below.

## Project structure

```sh
src/
├── components/ui/   # shadcn primitives — no data fetching, no app state
├── features/        # <domain>/{components,queries.ts,index.ts}
│   ├── orders/
│   ├── catalog/
│   └── conversations/
├── routes/          # TanStack Router route files + routeTree.gen.ts
├── i18n/            # index.ts, resources.ts, status-keys.ts, locales/<lng>/*.json
├── types/           # i18next.d.ts module augmentation
├── lib/             # api.ts, utils.ts, format.ts             ← api/utils exist today
├── index.css        # Tailwind entry                          ← exists today
└── main.tsx         # QueryClient + RouterProvider            ← exists today
```

A feature module owns everything about its domain — its components, its query
and mutation hooks, and a barrel that other code imports through:

```sh
src/features/orders/
├── components/      # OrdersTable.tsx, OrderStatusBadge.tsx, ...
├── queries.ts       # query options + useQuery/useMutation hooks
└── index.ts         # public exports
```

## The non-negotiable invariant: `components/ui/` is dumb

**Nothing under `components/ui/` may import `@tanstack/react-query` hooks or
`@/lib/api`.** These are generic shadcn primitives: data in via props, events
out via callbacks. That keeps them renderable and testable without a
`QueryClientProvider` and reusable across features.

`features/<feature>/components/` is a **different rule**: components there MAY be
"smart" — calling `useQuery`/`useMutation` directly is the established pattern,
not an exception. An `OrdersTable` fetching its own page of orders is correct;
don't lift that call into a route component just to pass it down. A feature
component owns its own data needs.

## Data layer: TanStack Query over `apiFetch`

- **Every server read and write goes through `apiFetch` from `@/lib/api`,
  wrapped in TanStack Query.** No raw `fetch` in a component, no axios, no
  second base URL. `apiFetch` is same-origin `/api/v1` with
  `credentials: 'include'` — Caddy proxies `/api` to NestJS on one domain, and
  Better Auth authenticates with a session cookie. Anything that bypasses it
  loses the cookie or the proxy path.
  **Auth endpoints** are Better Auth's, at `/api/v1/auth/*`, and they answer
  errors in the same coded envelope as every other route (`AUTH_*` codes), so
  call them through `apiFetch` too rather than Better Auth's own client. Any
  other route answers `AUTH_UNAUTHENTICATED` (401) without a session. The email
  flows land on SPA routes this app has to provide: the verification link
  redirects to the sign-up's `callbackURL` (send `'/'`), or to
  `/?error=INVALID_TOKEN|TOKEN_EXPIRED`; the reset link redirects to the
  forgot-password `redirectTo` (send `'/reset-password'`) with `?token=` or
  `?error=INVALID_TOKEN`, and that page POSTs `/api/v1/auth/reset-password`.
  Password rules come from `passwordSchema` in `@app/shared`.
- **Query keys are domain-namespaced arrays**: `['orders', 'list', filters]`,
  `['orders', 'detail', orderId]`. After a mutation, invalidate by prefix
  (`['orders']`) instead of refetching by hand.
- **Defaults are already set** in `main.tsx`: `staleTime: 30_000`, `retry: 1`.
  Override per query only with a reason — a live conversation view wanting
  fresher data is a reason; habit is not.
- Keep a domain's query options and hooks together in
  `features/<domain>/queries.ts` so components import a hook, not a raw key.
- **Known gap:** `apiFetch` throws a bare `Error` carrying only the method, path
  and HTTP status — it does not parse the API's error body. **There is also no
  error contract to parse yet**: the API currently throws three different shapes
  (a bare-string `ForbiddenException`, `{ message, issues }` from its Zod
  validation pipe, and an empty `UnauthorizedException`). Design that contract in
  `packages/shared`, so both sides import one definition, _before_ teaching the
  client to read it. Until then, don't write UI that branches on server error
  codes; show the message and move on.

## Routing

**Convention: file-based routing.** Routes are files under `src/routes/` —
`__root.tsx`, `index.tsx`, `orders.$orderId.tsx` — and `routeTree.gen.ts` is
generated by `@tanstack/router-plugin` and committed. `eslint.config.js` already
ignores `apps/web/src/routeTree.gen.ts`, so the repo was scaffolded for this.

**Current state:** `src/routes.tsx` is still code-based (`createRoute` /
`createRouter`) with two placeholder routes, and the plugin is not installed.
Migrate when the first real route lands — it is a small change now and a large
one later. Until then, follow the existing file's shape rather than inventing a
third pattern.

## Forms (react-hook-form + Zod + shadcn primitives)

**Zod schemas are imported from `@app/shared`, never redefined in `apps/web`.**
`packages/shared/src/schemas/` is the one source shared by API input validation,
these forms, and LLM output parsing. A form needing a narrower shape _derives_
it — `createProductSchema.pick({ name: true, variants: true })` — rather than
hand-writing a parallel schema that silently drifts from what the API accepts.

1. Derive the type, don't hand-write it: `type FormData = z.infer<typeof schema>`.
2. Validation messages are plain strings inside the shared schema.
3. Wire with `zodResolver`, build the UI from the shared primitives in
   `components/ui/form.tsx`, and set `noValidate` on the `<form>` so Zod is the
   only validation path:

```tsx
const form = useForm<CreateProduct>({
  resolver: zodResolver(createProductSchema),
  defaultValues: { name: '', aliases: [], variants: [] },
});

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
    <FormField
      control={form.control}
      name="name"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Product name</FormLabel>
          <FormControl>
            <Input {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  </form>
</Form>;
```

4. **Two separate error channels — don't conflate them.** Field-level Zod errors
   render inline via `FormMessage`. A failed request renders in a top-level
   banner driven by the mutation's `error`. Only use `form.setError(field, ...)`
   when a server error genuinely maps to one specific field.

**Build gotcha:** `@app/shared` resolves through its built `dist/`, so run
`pnpm --filter @app/shared build` after changing a shared schema or `apps/web`
will typecheck against the stale one.

## Money and domain invariants from `@app/shared`

These are correctness bugs, not style preferences.

- **Money is integer minor units** (paisa/cents) everywhere — never a float.
  Never write `price / 100` or `.toFixed(2)` in a component. Format with
  `formatMinorUnits(amount, currency)`, convert user input at the schema
  boundary with `toMinorUnits`, and total with `sumMinorUnits` — all from
  `@app/shared`.
- **Order status UI is driven by `canTransitionOrder(from, to)`**, not a
  hardcoded map of which buttons show for which status. The valid flow is
  `new → confirmed → packed → shipped → delivered`, plus `cancelled`, and it is
  defined once in `packages/shared/src/schemas/order.ts`.
- **Status labels derive from the shared enums** (`orderStatuses`, the
  conversation-state enum), so adding a state upstream can't silently render a
  blank cell.

## Security rules the UI must honor

From `docs/mvp/01-messenger-to-order/rules.md` — these bind the frontend too:

- **Never render, log, or put a Page access token or secret in the DOM, a query
  string, or the console.** If a token would be visible in a seller-facing
  screen, that screen is wrong.
- **Seller scoping is enforced server-side** by `merchant_id`. The SPA must never
  send a client-chosen merchant/tenant id as if it were a trust boundary — read
  identity from the session, don't pass it as a parameter.
- **No dashboard path creates an order without the customer's explicit
  confirmation** in Messenger. Order creation is the conversation flow's job; the
  dashboard edits and advances orders that already exist.

## Tailwind v4 and shadcn/ui

- Tailwind v4 runs through `@tailwindcss/vite` and is configured **in CSS**
  (`@import 'tailwindcss'` in `index.css`). There is **no `tailwind.config.js`
  and there should not be** — theme customization goes in CSS via `@theme`.
- **Interaction affordances.** Tailwind v4 dropped the
  `button, [role="button"] { cursor: pointer }` preflight reset that v3 shipped —
  `<button>` now defaults to the browser's `cursor: default`. Every clickable
  element (buttons, `role="button"` / `role="combobox"` custom triggers,
  `Select` / `Command` items) MUST set `cursor-pointer` explicitly, paired with
  `disabled:cursor-not-allowed` when it has a disabled state. Fix this once on
  the shared primitive (`components/ui/button.tsx`, `select.tsx`, ...) rather
  than patching it per call site — a one-off `className="cursor-pointer"` on a
  `Button` usage is a sign the base primitive is missing it.
- **shadcn is not initialized yet**: no `components.json`, no `components/ui/`.
  The pieces are in place — `cn()` in `@/lib/utils`, plus `cva`, `clsx`,
  `tailwind-merge` and `lucide-react` are all installed. Add components with the
  shadcn CLI into `src/components/ui/`; don't hand-copy them in.
- Dark mode is `color-scheme: light dark` plus `dark:` utilities — there is no
  theme provider or toggle. Match the existing `dark:` pairs when adding a new
  surface so it doesn't go white in dark mode.

## Copy

**All user-facing copy goes through react-i18next. No bare strings in JSX.** The
dashboard ships English only, and will for a while — but the translation layer is
fully wired, so adding a locale is dropping a JSON file in, never a refactor.

- **Setup lives in `src/i18n/`**: `index.ts` (the initialized singleton, imported
  for its side effect at the top of `main.tsx` — there is no `<I18nextProvider>`
  and there doesn't need to be), `resources.ts` (static JSON imports; the single
  source for both the runtime bundle and the key types),
  `locales/<lng>/<ns>.json`, and `status-keys.ts`. `src/types/i18next.d.ts`
  augments **`i18next`**'s `CustomTypeOptions` — not `react-i18next`, which only
  re-exports it, so declaring the module there is a silent no-op.
- **Namespaces mirror features**: `common` (nav, shared actions, error and empty
  states, status labels) plus `orders`, `catalog`, and — when their first screen
  lands — `conversations` and `settings`. `common` is the default:
  `useTranslation()` for shared copy, `useTranslation('orders')` inside a
  feature. To reach another namespace, request it —
  `useTranslation(['orders', 'common'])`, then `t('common:actions.save')`. Never
  duplicate a string across namespaces to avoid the prefix.
- **Keys are structural, not English**: `list.title`, `detail.emptyState`,
  `actions.markPacked`. Never key off the sentence — the key survives a copy
  change, `"Mark as packed"` does not. Sort keys alphabetically within their
  object so diffs stay readable. Avoid leaf keys ending in `_one` / `_other` /
  `_zero` unless they really are plurals; i18next reads those suffixes. Use v4
  JSON plurals (`key_one`, `key_other`), never the v3 `key_plural`.
- **A missing key is a typecheck failure, not a runtime fallback.** `t()` accepts
  only keys present in `locales/en`, and `strictKeyChecks` rejects a key that
  resolves to an object. If TypeScript rejects your key, add it to the JSON —
  never cast around it. Interpolation _variables_ are **not** checked (JSON
  string values widen to `string`), so read the placeholder in the JSON before
  passing options. Note that eslint is not type-checked here, so `pnpm typecheck`
  is the only gate that catches a bad key — lint will not.
- **Status labels come from `src/i18n/status-keys.ts`**, which maps every
  `@app/shared` enum member to a key with
  `as const satisfies Record<Enum, ParseKeys<'common'>>`. Adding a member
  upstream without a label fails the build — that is the point. Read them through
  `useStatusLabels()`, never by writing a status key at a call site.
- **Never format a number or date by hand.** Money and dates go through
  `useFormatters()` in `@/lib/format`, which passes i18next's active language
  into `formatMinorUnits` and `Intl.DateTimeFormat`. **`packages/shared` must
  never import i18next** — the locale crosses that boundary as a plain BCP-47
  string. Non-React callers (CSV row builders, comparators) use
  `currentLocale()`. There is no date library and shouldn't be one until real
  date _arithmetic_ shows up; formatting is `Intl`'s job.
- **`<html lang>` and the tab title are owned by `src/i18n/index.ts`**, via a
  `languageChanged` listener. Don't set either from a component.
- **English only, today.** Don't add a second locale directory or a language
  switcher speculatively. The detector runs `?lng=` → localStorage → navigator,
  so a new locale can be smoke-tested with a query string before any switcher UI
  exists; build the switcher in the PR that adds the second locale. That PR
  should also move locale JSON off static imports (`import.meta.glob` +
  `addResourceBundle`), since bundling every language for every seller only stops
  being free at locale two.

## Testing

> **Not wired up yet.** `pnpm --filter web test` is a no-op echo and no runner is
> installed. When the first frontend test lands, set up **Vitest** +
> `@testing-library/react`. (`apps/api` uses Jest; the two don't need to match.)

The rules, for whenever that happens:

- Tests live in a colocated `__tests__/` directory, never as a sibling file —
  this convention is repo-wide.
- Assert on rendered output — visible text, ARIA roles, validation messages —
  not implementation details.
- **Mock `apiFetch`, not `fetch`.** Render inside a fresh `QueryClientProvider`
  per test with `retry: false`, so a failure path doesn't wait on retries.
- For a form: an invalid submit shows the Zod messages and does **not** call the
  mutation; a valid submit calls it with the right payload; a failed request
  renders the banner rather than a field error.
- **`environment: 'jsdom'` is required**, not just convenient — `src/i18n/index.ts`
  touches `document` at module scope. Point `setupFiles` at a file that imports
  `@/i18n` so the singleton is initialized once per run.
- **Don't mock `react-i18next`.** Resources are bundled, so `t()` returns real
  English in tests and assertions read as visible copy — which is what the rule
  above already asks for. Mocking `t` to echo the key makes every assertion
  meaningless.

## Related skills

- **`backend-engineer`** — `apps/api`, which serves these endpoints and owns the
  error envelope, the shared Zod schemas and the `merchant_id` scoping rules.
- **`rest-api-design`** — the endpoint shapes `features/*/queries.ts` calls
  against.

## Pre-merge review checklist

- [ ] New domain code lives in `src/features/<feature>/`, not loose in `src/`.
- [ ] Nothing in `components/ui/` imports a TanStack Query hook or `@/lib/api`.
- [ ] All server access goes through `apiFetch` + TanStack Query, with
      namespaced query keys and prefix invalidation after mutations — no raw
      `fetch`/axios anywhere.
- [ ] Form schemas are imported or derived from `@app/shared`, never redefined
      locally; `zodResolver` + shared `form.tsx` primitives + `noValidate`.
- [ ] Field errors (`FormMessage`) and request errors (banner) are not conflated.
- [ ] No user-facing string is hardcoded in JSX — every one resolves through
      `t()` with a key that exists in `locales/en`.
- [ ] Money and dates go through `useFormatters()` from `@/lib/format`; nothing
      in `packages/shared` imports i18next.
- [ ] Money uses `formatMinorUnits` / `toMinorUnits` / `sumMinorUnits` — no
      `/ 100`, no `toFixed`, no float arithmetic on currency.
- [ ] Order status UI is gated by `canTransitionOrder`, and labels come from
      `status-keys.ts` via `useStatusLabels()`, not from the shared enums
      directly.
- [ ] No token, secret, or client-supplied merchant id is rendered, logged, or
      sent as a trust boundary.
- [ ] Every clickable element has `cursor-pointer` (plus
      `disabled:cursor-not-allowed` where applicable), fixed at the primitive.
- [ ] No `tailwind.config.js` added; new surfaces carry their `dark:` variants.
- [ ] Imports use the `@/` alias, not deep relative chains.
- [ ] `pnpm --filter @app/shared build` was run if a shared schema changed.
