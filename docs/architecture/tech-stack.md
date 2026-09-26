# Tech stack

## Principles

Self-host where practical on free, open-source libraries; recurring costs
limited to the VPS, the domain, and pay-per-use LLM calls; all user data stays
in our own database. Webhook processing is queue-based and the LLM only parses —
a deterministic state machine drives the conversation and code validates every
extracted item against the catalog. LLM cost is tracked per conversation. Tests
are written alongside features, and the evaluation set of real conversations is
run after every prompt change. The mechanics of both are in
[`backend-engineer`](../../.claude/skills/backend-engineer/SKILL.md)
(§"Queue and worker", §"LLM boundaries").

## Chosen stack

| Area                | Decision                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend             | NestJS. API and worker share one codebase; the worker boots via `createApplicationContext`.                                                                                                                        |
| Frontend            | React 19 (Vite SPA), TanStack Router (code-based) + TanStack Query, Tailwind v4 (CSS-first), shadcn/ui (not initialized), react-hook-form, react-i18next.                                                          |
| Repo                | pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`. Everything database-related lives in `apps/api`.                                                                                                       |
| Validation          | Zod schemas in `packages/shared` for API input, forms, and LLM output.                                                                                                                                             |
| Database            | Postgres + Drizzle. Global NestJS `DatabaseModule`; Better Auth shares the same instance through its Drizzle adapter.                                                                                              |
| Schema & migrations | TS schema in `apps/api/src/database/schema/` as desired state; drizzle-kit generates SQL into `db/migrations/`. `drizzle-kit push` is never used.                                                                  |
| Types               | Inferred from the schema — no codegen step and no live database needed. CI fails if a schema change has no migration.                                                                                              |
| Message ordering    | Drizzle `.for('update')` on the conversation row inside a short transaction. Not available on the relational (`db.query.*`) API.                                                                                   |
| Queue               | BullMQ + Redis (`noeviction`, AOF persistence).                                                                                                                                                                    |
| Auth                | Better Auth: email/password, Google, Facebook; Organization plugin for multi-tenancy, the seller's organization created at signup and resolved onto the session as `activeOrganizationId`; tenant guard in NestJS. |
| Messenger           | Graph API via `fetch`, pinned API version, raw-body HMAC signature verification, own Page connection flow.                                                                                                         |
| Secrets             | Page tokens encrypted with AES-256-GCM (Node `crypto`); key in an env var.                                                                                                                                         |
| LLM                 | AI SDK behind an `extractOrder()` wrapper, structured output with Zod schemas. Evaluation set of 100–200 real messages, scored per provider.                                                                       |
| Email               | Nodemailer over SMTP on a transactional provider's free tier; swappable without code changes.                                                                                                                      |
| Hosting             | Single VPS running Docker Compose: Caddy, api, worker, Postgres, Redis.                                                                                                                                            |
| Reverse proxy       | Caddy with automatic HTTPS; serves the SPA and proxies `/api` on the same domain. Also serves the static Meta compliance pages.                                                                                    |
| Config & ops        | `@nestjs/config` + Zod-validated env, `@nestjs/throttler` (Redis), nestjs-pino, `@nestjs/terminus` health checks, Uptime Kuma, Sentry optional.                                                                    |
| Backups             | Nightly `pg_dump`, multi-day retention, copied off the server.                                                                                                                                                     |
| Server security     | SSH keys only, firewall allowing 80/443/SSH, automatic security updates.                                                                                                                                           |
| CI/CD               | GitHub Actions: lint, typecheck, test, migrate, RLS check, uncommitted-migration check, build images, deploy over SSH.                                                                                             |
| Local development   | Cloudflare Tunnel for a public HTTPS webhook URL. drizzle-kit diffs against snapshots, so no shadow database is needed.                                                                                            |
| Testing             | Jest in `apps/api`, Vitest in `apps/web` when its first test lands, plus an LLM evaluation script.                                                                                                                 |
| Payments            | Cash on delivery. Payment links after the pilot.                                                                                                                                                                   |
