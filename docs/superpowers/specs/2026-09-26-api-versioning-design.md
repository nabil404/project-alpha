# API versioning — design

Date: 2026-09-26 · Status: approved in chat, awaiting spec review

## Intent

Put the API's URL shape in place for **future outside consumers** (a public or
partner API, a post-MVP mobile app) before any business routes exist. The SPA
ships in lockstep with the API from the same repo, so it gains nothing from
versioning itself; the point is that no external contract is ever published
unversioned.

Decisions made in brainstorming:

- **Scope: everything under `/api` moves to `/api/v1`** — our own routes,
  Better Auth, and the Messenger webhook. `/health` is not under `/api` and stays
  where it is. Moving now is cheapest: it is Week 1, no seller holds an emailed
  auth link, and the only Meta webhook registration is the dev tunnel app.
- **Mechanism: Nest URI versioning**, not a hardcoded `api/v1` prefix, so a
  later breaking change can add a v2 handler to one route while v1 keeps
  serving.

## Resulting URL map

| Before                    | After                        |
| ------------------------- | ---------------------------- |
| `/api/<resource>`         | `/api/v1/<resource>`         |
| `/api/auth/*`             | `/api/v1/auth/*`             |
| `/api/webhooks/messenger` | `/api/v1/webhooks/messenger` |
| `/health`                 | `/health` (unchanged)        |

After the change, any unversioned `/api/<x>` is a 404 in the coded error
envelope.

## Changes

### Routing (`apps/api`)

- `src/bootstrap.ts` — `configureApp` keeps
  `setGlobalPrefix('api', { exclude: ['health'] })` and adds
  `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`.
  Supertest runs call `configureApp` too, so tests see production URLs.
- `src/health/health.module.ts` — the controller gets
  `version: VERSION_NEUTRAL`, so URI versioning does not turn it into
  `/v1/health`.
- `src/modules/messenger/messenger.controller.ts` — no code change; it inherits
  `defaultVersion` and lands at `/api/v1/webhooks/messenger`.
- `src/auth/auth.config.ts` — `basePath: '/api/v1/auth'`.
  `@thallesp/nestjs-better-auth` mounts Better Auth as middleware at that
  `basePath` and excludes it from Nest's global prefix, so Nest versioning never
  touches it. Better Auth builds verification and reset links from
  `baseURL + basePath`, so emails follow automatically. The path is a literal:
  it does **not** move with a future v2, because we do not own that contract.

An unversioned `/api/<x>` falls through to Nest's `NotFoundException`, which
`AllExceptionsFilter` already renders as the coded envelope. No new error code.

### Client and infrastructure

- `apps/web/src/lib/api.ts` — base becomes `` `/api/v1${path}` ``.
- `docker/Caddyfile` (`handle /api/*`) and `apps/web/vite.config.ts` (proxy on
  `/api`) already match the new paths; no change.

### Manual step (outside the repo)

- Update the webhook callback URL in the Meta app dashboard to
  `https://<tunnel-or-domain>/api/v1/webhooks/messenger` and re-verify.

### Comments and docs

Replace `/api/auth/*` and `/api/webhooks/messenger` references with their `/v1`
forms in:

- `AGENTS.md` (Conventions: "Better Auth itself is mounted at `/api/auth/*`")
- `.claude/skills/backend-engineer/SKILL.md`
- `.claude/skills/frontend-engineer/SKILL.md` (`apiFetch` base, auth endpoints,
  reset-password POST)
- `.claude/skills/rest-api-design/references/response-formats.md` (Better Auth
  heading; pagination link examples)
- Comments in `src/bootstrap.ts`, `src/auth/auth.module.ts`,
  `src/auth/auth-errors.ts`, `src/common/redact-url.ts`

`redact-url.ts` itself needs no logic change: it matches query-parameter names
and a `/reset-password/` path fragment, not a fixed prefix.

### Versioning policy

Add to `.claude/skills/rest-api-design/SKILL.md` as the house rule, replacing
the generic "version your API" line:

- Additive changes — a new route, a new optional request field, a new response
  field — stay in v1.
- A breaking change adds a `@Version('2')` handler on the affected route only;
  the v1 handler keeps serving alongside it. No wholesale v2 copy of the API.
- Deprecation windows and `Deprecation`/`Sunset` headers are deferred until an
  outside consumer exists.
- Better Auth's and Meta's paths are pinned literals and are not bumped with
  our versions.

## Testing

- Update URL fixtures in `src/__tests__/error-envelope.spec.ts`,
  `src/auth/__tests__/email-password.e2e.spec.ts`,
  `src/common/__tests__/redact-url.spec.ts` and
  `src/modules/mail/__tests__/templates.spec.ts` to the `/api/v1` forms.
- New `src/__tests__/versioning.spec.ts` (supertest through `configureApp`),
  asserting:
  - a demo controller answers at `/api/v1/demo`;
  - `/api/demo` returns 404 in the coded envelope;
  - `/health` answers unprefixed and unversioned;
  - Better Auth answers `GET /api/v1/auth/ok` and not `/api/auth/ok`.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` green.

## Out of scope

- A shared `API_BASE` constant in `packages/shared` — one client, one literal.
- OpenAPI documentation.
- Header- or media-type-based versioning.
- Deprecation headers and sunset policy.
