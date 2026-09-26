# API Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve every route under `/api` at `/api/v1/...` (our controllers, Better Auth, the Messenger webhook), keep `/health` unversioned, and record the versioning policy.

**Architecture:** Nest URI versioning (`enableVersioning({ type: URI, defaultVersion: '1' })`) on top of the existing `api` global prefix, wired in `configureApp` so production and supertest share it. Health opts out with `VERSION_NEUTRAL`. Better Auth is mounted as middleware at its own `basePath`, outside Nest routing, so it moves by changing that literal to `/api/v1/auth`.

**Tech Stack:** NestJS 12 (ESM), `@thallesp/nestjs-better-auth`, Better Auth, Jest + supertest (`apps/api`), React/Vite (`apps/web`).

**Spec:** `docs/superpowers/specs/2026-09-26-api-versioning-design.md`

## Global Constraints

- Every relative import ends in `.js`, including in specs (`"type": "module"`, NodeNext).
- Tests live in a colocated `__tests__/` directory, never as a sibling file.
- Errors leave the API as `{ error: { code, message, params } }`; an unmatched route is `HTTP_404`. Do not add an error code.
- Commit messages: plain imperative sentence in the repo's style (e.g. `Version the API under /api/v1`), **no co-author trailers** (AGENTS.md).
- Do not create `CLAUDE.md` or `CLAUDE.local.md`. Do not stage `.claude/settings.json` (unrelated local change).
- `apps/api` tests resolve `@app/shared` through its built `dist`: run `pnpm --filter @app/shared build` once before the first test run.
- The e2e spec `src/auth/__tests__/email-password.e2e.spec.ts` is skipped unless `DATABASE_ADMIN_URL` is set. Bring Postgres up with `pnpm dev:up` and run it with the variable exported (command given in each task). **A skipped run is not a pass.**
- Better Auth's path is the literal `/api/v1/auth`, not derived from a shared version constant: it does not move with a future v2.

## Review Focus

1. **Emailed links.** The verification and reset links Better Auth sends must point at `/api/v1/auth/...`, or every new seller's link is a 404. Pinned in Task 2 (assert the link path in the verify test and in `resetToken`).
2. **Meta's handshake at the new URL.** `GET /api/v1/webhooks/messenger?hub.mode=subscribe&hub.verify_token=…&hub.challenge=42` must echo `42`, or re-registering the webhook in the Meta dashboard fails. Pinned in Task 1.
3. **Health stays put.** `/health` answers 200, and `/v1/health` and `/api/v1/health` are 404. Caddy, the container healthcheck and Uptime Kuma all probe `/health`. Pinned in Task 1.
4. **Old paths fail loudly.** `/api/<x>`, `/api/webhooks/messenger` and `/api/auth/*` answer a coded `HTTP_404` rather than silently still working. Pinned in Tasks 1 and 2.
5. **Body parsing around the moved mount.** The library skips Nest's JSON parser for requests under `basePath` and parses everything else with `req.rawBody` attached. After the move, Better Auth must still receive unparsed bodies (sign-up works), and non-auth routes must keep `rawBody` (webhook signature check). Pinned by the existing sign-up flow and the `/api/v1/demo/raw` test (Tasks 1 and 2).

**Known risk.** `@thallesp/nestjs-better-auth` registers its handler with `forRoutes('*path')`, and Nest applies global-prefix and versioning rules to middleware routes. If enabling versioning in Task 1 makes the **unchanged** Better Auth e2e tests fail (auth stops answering, or bodies arrive already parsed), stop. Debug it with superpowers:systematic-debugging and report back. Do not work around it by hand-mounting Better Auth or loosening tests.

---

## File map

| File                                                               | Change                                                     | Task |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ---- |
| `apps/api/src/__tests__/versioning.spec.ts`                        | **Create.** URL map for Nest-routed controllers            | 1    |
| `apps/api/src/bootstrap.ts`                                        | Enable URI versioning; comments                            | 1, 2 |
| `apps/api/src/health/health.module.ts`                             | `VERSION_NEUTRAL`                                          | 1    |
| `apps/api/src/__tests__/error-envelope.spec.ts`                    | `/api/demo` → `/api/v1/demo`                               | 1    |
| `apps/api/src/auth/__tests__/email-password.e2e.spec.ts`           | Demo URLs (T1); auth URLs + mount and link assertions (T2) | 1, 2 |
| `apps/api/src/auth/auth.config.ts`                                 | `basePath: '/api/v1/auth'`; comment                        | 2    |
| `apps/api/src/auth/auth.module.ts`, `auth-errors.ts`               | Comments                                                   | 2    |
| `apps/api/src/common/redact-url.ts`                                | Comment only                                               | 2    |
| `apps/api/src/common/__tests__/redact-url.spec.ts`                 | Fixtures                                                   | 2    |
| `apps/api/src/modules/mail/__tests__/templates.spec.ts`            | Fixture                                                    | 2    |
| `apps/web/src/lib/api.ts`                                          | Base `/api/v1`                                             | 2    |
| `AGENTS.md`, `.claude/skills/{backend,frontend}-engineer/SKILL.md` | Path references                                            | 3    |
| `.claude/skills/rest-api-design/SKILL.md`                          | Versioning policy                                          | 3    |
| `.claude/skills/rest-api-design/references/response-formats.md`    | Path references                                            | 3    |

No change: `docker/Caddyfile` (`handle /api/*`), `apps/web/vite.config.ts` (proxy `/api`), `messenger.controller.ts` (inherits `defaultVersion`), `redact-url.ts` logic (not keyed on the prefix).

---

### Task 1: Version Nest-routed controllers under `/api/v1`

**Files:**

- Create: `apps/api/src/__tests__/versioning.spec.ts`
- Modify: `apps/api/src/bootstrap.ts:17-28`
- Modify: `apps/api/src/health/health.module.ts:1,9`
- Modify: `apps/api/src/__tests__/error-envelope.spec.ts` (four `/api/demo/` URLs)
- Modify: `apps/api/src/auth/__tests__/email-password.e2e.spec.ts` (every `'/api/demo/` URL; auth URLs untouched)

**Interfaces:**

- Consumes: `configureApp(app, logger)` from `src/bootstrap.ts`; `HealthController` (exported) from `src/health/health.module.ts`; `MessengerController` from `src/modules/messenger/messenger.controller.ts`, which injects `AppConfig` and `@InjectQueue(MESSENGER_QUEUE)`; `DATABASE` token from `src/database/database.module.ts`.
- Produces: every Nest controller without an explicit version is served at `/api/v1/<path>`. Controllers marked `VERSION_NEUTRAL` keep their unversioned path. Task 2 relies on `configureApp` doing this.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/versioning.spec.ts`:

```ts
import { Controller, Get, type INestApplication, type LoggerService } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import request from 'supertest';
import { configureApp } from '../bootstrap.js';
import { AppConfig } from '../config/app.config.js';
import { DATABASE } from '../database/database.module.js';
import { HealthController } from '../health/health.module.js';
import { MessengerController } from '../modules/messenger/messenger.controller.js';
import { MESSENGER_QUEUE } from '../modules/queue/queue.constants.js';

const VERIFY_TOKEN = 'verify-me';

const silentLogger = { error: () => {} } as unknown as LoggerService;

@Controller('demo')
class DemoController {
  @Get()
  hello() {
    return { ok: true };
  }
}

/**
 * The public URL map, through the same configureApp() wiring main.ts uses.
 * Better Auth is mounted outside Nest routing; its path is covered by the
 * email/password e2e spec.
 */
describe('API versioning', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [DemoController, HealthController, MessengerController],
      providers: [
        { provide: DATABASE, useValue: { execute: async () => [] } },
        {
          provide: AppConfig,
          useValue: { get: (key: string) => (key === 'META_VERIFY_TOKEN' ? VERIFY_TOKEN : '') },
        },
        { provide: getQueueToken(MESSENGER_QUEUE), useValue: { add: async () => undefined } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, silentLogger);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves our routes under /api/v1', async () => {
    await request(server()).get('/api/v1/demo').expect(200, { ok: true });
  });

  it('answers an unversioned path with the coded 404', async () => {
    const response = await request(server()).get('/api/demo');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('HTTP_404');
  });

  it('keeps /health unprefixed and unversioned', async () => {
    const response = await request(server()).get('/health').expect(200);
    expect(response.body.status).toBe('ok');

    await request(server()).get('/v1/health').expect(404);
    await request(server()).get('/api/v1/health').expect(404);
  });

  it("completes Meta's verification handshake at /api/v1/webhooks/messenger", async () => {
    const response = await request(server())
      .get('/api/v1/webhooks/messenger')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '42' })
      .expect(200);

    expect(response.text).toBe('42');
  });

  it('no longer answers Meta at the unversioned path', async () => {
    const response = await request(server())
      .get('/api/webhooks/messenger')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '42' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('HTTP_404');
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `pnpm --filter @app/shared build && pnpm --filter api test -- src/__tests__/versioning.spec.ts`
Expected: FAIL. `serves our routes under /api/v1`, `completes Meta's verification handshake…`, `answers an unversioned path…` and `no longer answers Meta…` fail, because routes still live at `/api/...`. `keeps /health unprefixed…` passes.

- [ ] **Step 3: Enable URI versioning in `configureApp`**

In `apps/api/src/bootstrap.ts`, change the import on line 1 to:

```ts
import {
  VersioningType,
  type INestApplication,
  type LoggerService,
  type NestApplicationOptions,
} from '@nestjs/common';
```

Replace `configureApp` and its doc comment (lines 17-28) with:

```ts
/**
 * HTTP-layer wiring shared by main.ts and the supertest run, so a test
 * exercises the same routes and the same error envelope as production.
 *
 * Every controller lands at /api/v1/...; a breaking change adds a
 * @Version('2') handler to the affected route only, beside the v1 one.
 * /health opts out with VERSION_NEUTRAL. Better Auth is mounted at its own
 * literal basePath (auth.config.ts) and never passes through Nest routing.
 *
 * The logger is passed in rather than pulled from the container so this stays
 * independent of how it was provided. The worker boots through
 * createApplicationContext and has no HTTP server — it must not call this.
 */
export function configureApp(app: INestApplication, logger: LoggerService): void {
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
}
```

- [ ] **Step 4: Mark health version-neutral**

In `apps/api/src/health/health.module.ts`, change line 1 to:

```ts
import { Controller, Get, Inject, Module, VERSION_NEUTRAL } from '@nestjs/common';
```

and replace `@Controller('health')` with:

```ts
@Controller({ path: 'health', version: VERSION_NEUTRAL })
```

- [ ] **Step 5: Run the new test and check that it passes**

Run: `pnpm --filter api test -- src/__tests__/versioning.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Move the demo URLs in the two existing supertest specs**

```bash
sed -i '' "s#'/api/demo/#'/api/v1/demo/#g" apps/api/src/__tests__/error-envelope.spec.ts apps/api/src/auth/__tests__/email-password.e2e.spec.ts
```

Leave `'/api/nope'` in `error-envelope.spec.ts` alone: it's meant to be unmatched, and still is. Leave every `'/api/auth/` URL alone; Task 2 moves those.

Check: `grep -n "'/api/demo" apps/api/src -r` prints nothing.

- [ ] **Step 7: Run the whole API suite, including the database-backed e2e**

```bash
pnpm dev:up
```

```bash
DATABASE_ADMIN_URL="$(grep '^DATABASE_ADMIN_URL=' apps/api/.env | cut -d= -f2-)" pnpm --filter api test
```

Expected: all suites PASS. `email/password auth over HTTP` must show as **run, not skipped**, with Better Auth still at `/api/auth` and the demo routes at `/api/v1/demo`. If the auth tests fail here, see **Known risk** above and stop.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter api typecheck && pnpm --filter api lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/__tests__/versioning.spec.ts apps/api/src/bootstrap.ts apps/api/src/health/health.module.ts apps/api/src/__tests__/error-envelope.spec.ts apps/api/src/auth/__tests__/email-password.e2e.spec.ts
git commit -m "Serve Nest routes under /api/v1 with URI versioning"
```

---

### Task 2: Move Better Auth to `/api/v1/auth` and the SPA client to `/api/v1`

After this task every `/api` path is versioned, so the SPA's single client moves in the same commit. `apiFetch` also calls the Better Auth endpoints.

**Files:**

- Modify: `apps/api/src/auth/auth.config.ts:71,77,97`
- Modify: `apps/api/src/auth/__tests__/email-password.e2e.spec.ts` (auth URLs, link assertions, new `mount point` block)
- Modify: `apps/api/src/auth/auth.module.ts:11` (comment)
- Modify: `apps/api/src/auth/auth-errors.ts:13` (comment)
- Modify: `apps/api/src/bootstrap.ts:8` (comment in `NEST_APP_OPTIONS` doc)
- Modify: `apps/api/src/common/redact-url.ts:3-6,11` (comment only)
- Modify: `apps/api/src/common/__tests__/redact-url.spec.ts` (fixtures)
- Modify: `apps/api/src/modules/mail/__tests__/templates.spec.ts:3` (fixture)
- Modify: `apps/web/src/lib/api.ts:4,6`

**Interfaces:**

- Consumes: `configureApp` from Task 1 (URI versioning enabled); `CapturingMailer.linkTo(to): string` in the e2e spec, which returns the emailed link's `pathname + search`.
- Produces: Better Auth answers at `/api/v1/auth/*`, and emailed links carry that path. `apiFetch(path)` requests `/api/v1${path}`.

- [ ] **Step 1: Write the failing assertions in the e2e spec**

In `apps/api/src/auth/__tests__/email-password.e2e.spec.ts`:

(a) Move every Better Auth URL:

```bash
sed -i '' "s#'/api/auth/#'/api/v1/auth/#g" apps/api/src/auth/__tests__/email-password.e2e.spec.ts
```

Check: `grep -n "/api/auth" apps/api/src/auth/__tests__/email-password.e2e.spec.ts` prints nothing.

(b) In `it('verifies, signs the seller in and resolves their organization', …)`, directly after `await signUp(address).expect(200);`, add:

```ts
expect(mailer.linkTo(address)).toMatch(/^\/api\/v1\/auth\/verify-email\?token=/);
```

(c) In the `resetToken` helper under `describe('password reset')`, directly after `expect(mailer.lastTo(address).subject).toBe('Reset your password');`, add:

```ts
expect(mailer.linkTo(address)).toMatch(/^\/api\/v1\/auth\/reset-password\/[^/?]+/);
```

(d) Before `describe('non-auth routes', …)`, add:

```ts
describe('mount point', () => {
  it('serves Better Auth under /api/v1/auth only', async () => {
    await request(server()).get('/api/v1/auth/ok').expect(200, { ok: true });

    const legacy = await request(server()).get('/api/auth/ok');
    expect(legacy.status).toBe(404);
    expect(legacy.body.error.code).toBe('HTTP_404');
  });
});
```

- [ ] **Step 2: Run the e2e spec and check that it fails**

Run: `DATABASE_ADMIN_URL="$(grep '^DATABASE_ADMIN_URL=' apps/api/.env | cut -d= -f2-)" pnpm --filter api test -- src/auth/__tests__/email-password.e2e.spec.ts`
Expected: FAIL (run, not skipped). Requests to `/api/v1/auth/...` get 404, the link-path assertions see `/api/auth/...`, and `/api/auth/ok` answers 200.

- [ ] **Step 3: Change the `basePath`**

In `apps/api/src/auth/auth.config.ts`, replace `basePath: '/api/auth',` with:

```ts
    // A literal, not derived from the API version: this is Better Auth's
    // contract, not ours, and it does not move with a future /api/v2.
    basePath: '/api/v1/auth',
```

In the doc comment above `createAuth`, change `The HTTP surface is mounted at /api/auth by AuthModule (auth.module.ts).` to `The HTTP surface is mounted at /api/v1/auth by AuthModule (auth.module.ts).`, and change `page POSTs /api/auth/reset-password with the token and new password.` to `page POSTs /api/v1/auth/reset-password with the token and new password.`

- [ ] **Step 4: Run the e2e spec and check that it passes**

Run: `DATABASE_ADMIN_URL="$(grep '^DATABASE_ADMIN_URL=' apps/api/.env | cut -d= -f2-)" pnpm --filter api test -- src/auth/__tests__/email-password.e2e.spec.ts`
Expected: PASS, not skipped, including `mount point` and `non-auth routes`.

- [ ] **Step 5: Update the remaining fixtures and comments**

```bash
sed -i '' "s#/api/auth/#/api/v1/auth/#g; s#/api/webhooks/#/api/v1/webhooks/#g; s#'/api/orders#'/api/v1/orders#g" apps/api/src/common/__tests__/redact-url.spec.ts
sed -i '' "s#/api/auth/#/api/v1/auth/#g" apps/api/src/modules/mail/__tests__/templates.spec.ts
```

In `apps/api/src/common/redact-url.ts`, replace the list and the later sentence in the header comment (logic untouched):

```ts
 *   - /api/v1/webhooks/messenger?hub.verify_token=...  Meta's subscription check
 *   - /api/v1/auth/verify-email?token=...              the email verification link
 *   - /api/v1/auth/reset-password/<token>?...          the reset link
 *   - /api/v1/auth/callback/<provider>?code=...        an OAuth authorization code
```

```ts
 * Better Auth answers /api/v1/auth/* before Nest's middleware runs, so pino-http
```

In `apps/api/src/auth/auth.module.ts`, change ` * Mounts Better Auth at /api/auth through @thallesp/nestjs-better-auth, which` to ` * Mounts Better Auth at /api/v1/auth through @thallesp/nestjs-better-auth, which`.

In `apps/api/src/auth/auth-errors.ts`, change `the SPA reads /api/auth/* errors exactly as it reads every other endpoint's.` to `the SPA reads /api/v1/auth/* errors exactly as it reads every other endpoint's.`

In `apps/api/src/bootstrap.ts`, in the `NEST_APP_OPTIONS` doc comment, change `/api/auth request` to `/api/v1/auth request`.

Check: `grep -rn "/api/auth\|/api/webhooks" apps/api/src` prints only the two deliberate legacy-path assertions: `'/api/auth/ok'` in the e2e `mount point` test and `'/api/webhooks/messenger'` in `versioning.spec.ts`.

- [ ] **Step 6: Move the SPA client**

In `apps/web/src/lib/api.ts`, replace lines 4 and 6:

```ts
/** Same-origin API client: Caddy proxies /api to the NestJS app, which serves /api/v1. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
```

Caddy's `handle /api/*` and the Vite proxy on `/api` already match. Don't change them.

- [ ] **Step 7: Run everything touched**

```bash
DATABASE_ADMIN_URL="$(grep '^DATABASE_ADMIN_URL=' apps/api/.env | cut -d= -f2-)" pnpm --filter api test
```

```bash
pnpm typecheck && pnpm lint
```

Expected: all API suites PASS with the e2e run, not skipped. Typecheck and lint are clean for `api` and `web`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth apps/api/src/bootstrap.ts apps/api/src/common apps/api/src/modules/mail/__tests__/templates.spec.ts apps/web/src/lib/api.ts
git commit -m "Move Better Auth to /api/v1/auth and point the SPA at /api/v1"
```

---

### Task 3: Docs and versioning policy

**Files:**

- Modify: `AGENTS.md:255-257`
- Modify: `.claude/skills/backend-engineer/SKILL.md:32,37,98,383`
- Modify: `.claude/skills/frontend-engineer/SKILL.md:79-80,83,91`
- Modify: `.claude/skills/rest-api-design/SKILL.md` (Best Practices)
- Modify: `.claude/skills/rest-api-design/references/response-formats.md:36-40,115`

**Interfaces:**

- Consumes: the URL map from Tasks 1 and 2.
- Produces: nothing code-facing.

- [ ] **Step 1: Replace path references**

```bash
sed -i '' "s#/api/auth/\*#/api/v1/auth/*#g; s#/api/auth/reset-password#/api/v1/auth/reset-password#g" AGENTS.md .claude/skills/backend-engineer/SKILL.md .claude/skills/frontend-engineer/SKILL.md .claude/skills/rest-api-design/references/response-formats.md
sed -i '' 's#"/api/products?#"/api/v1/products?#g' .claude/skills/rest-api-design/references/response-formats.md
```

Then edit by hand:

- `.claude/skills/backend-engineer/SKILL.md` line 32. Replace `- The global route prefix is \`api\`, with \`/health\` excluded (\`src/bootstrap.ts\`).` with:

  ```markdown
  - Routes are served at `/api/v1/...`: global prefix `api` plus Nest URI
    versioning with `defaultVersion: '1'` (`src/bootstrap.ts`). `/health` is
    excluded from the prefix and marked `VERSION_NEUTRAL`. Versioning policy:
    `rest-api-design`.
  ```

- `.claude/skills/backend-engineer/SKILL.md` line 383. Change `same-origin \`/api\` client`to`same-origin \`/api/v1\` client`.
- `.claude/skills/frontend-engineer/SKILL.md` lines 79-80. Change `\`apiFetch\` is same-origin \`/api\` with`to`\`apiFetch\` is same-origin \`/api/v1\` with`. Leave "Caddy proxies \`/api\` to NestJS" as it is, since it's accurate.

- [ ] **Step 2: Write the versioning policy**

In `.claude/skills/rest-api-design/SKILL.md`, under `### ✅ DO`, replace the line `- Version your API` with:

```markdown
- Version your API — see "Versioning in this repo" below
```

Then add this section directly after the `### ❌ DON'T` list, before the next `##` heading:

```markdown
### Versioning in this repo

Routes live at `/api/v1/...` through Nest URI versioning (`configureApp` in
`apps/api/src/bootstrap.ts`, `defaultVersion: '1'`).

- **Additive changes stay in v1:** a new route, a new optional request field, a
  new response field.
- **A breaking change versions one route, not the API.** Add a
  `@Version('2')` handler for the affected route beside the existing one,
  which keeps serving v1. Never copy the whole API into a v2.
- **Pinned paths:** Better Auth's `basePath` (`/api/v1/auth`) and the Meta
  webhook (`/api/v1/webhooks/messenger`) follow contracts we don't own. They
  are not bumped with our versions. `/health` is `VERSION_NEUTRAL`.
- **Deferred:** deprecation windows and `Deprecation`/`Sunset` headers wait
  until an outside consumer exists.
```

- [ ] **Step 3: Check that no stale references remain**

Run: `grep -rn "/api/auth\|/api/webhooks\|'/api/demo\|\"/api/products" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git .`
Expected: the only hits are under `docs/superpowers/` (this plan and its spec, which describe the before state), plus the two deliberate legacy-path assertions: `'/api/auth/ok'` in `email-password.e2e.spec.ts` and `'/api/webhooks/messenger'` in `versioning.spec.ts`.

- [ ] **Step 4: Full verification**

```bash
pnpm format:check && pnpm typecheck && pnpm lint
```

```bash
DATABASE_ADMIN_URL="$(grep '^DATABASE_ADMIN_URL=' apps/api/.env | cut -d= -f2-)" pnpm test
```

Expected: everything passes, and the e2e suite runs rather than being skipped. If `format:check` flags a markdown file you edited, run `npx prettier --write <file>` and re-check.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md .claude/skills/backend-engineer/SKILL.md .claude/skills/frontend-engineer/SKILL.md .claude/skills/rest-api-design/SKILL.md .claude/skills/rest-api-design/references/response-formats.md
git commit -m "Document /api/v1 routes and the API versioning policy"
```

---

## Manual follow-ups (outside the repo, for the human)

- **Meta app dashboard:** set the webhook callback URL to `https://<tunnel-or-domain>/api/v1/webhooks/messenger` and re-verify.
- **Google / Facebook sign-in (not yet wired):** when those providers are configured, register the OAuth redirect URIs as `https://<domain>/api/v1/auth/callback/google` and `…/callback/facebook`.
