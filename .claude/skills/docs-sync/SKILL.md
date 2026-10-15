---
name: docs-sync
description: Check that every doc a code change affects was updated in the same change, report each gap with evidence, then fix the docs. Covers feature pages under docs/features/, docs/architecture/ (ai.md, database.md, deployment.md, tech-stack.md), docs/setup/, the features index, AI phase progress, AGENTS.md and the README. Use this before committing, before opening or updating a PR, after finishing a feature or fix, and whenever the user asks whether docs are up to date, in sync or stale, or asks to "check the docs", "update the docs for this change" or "did I miss any docs". Use it even when the user only says the work is done and asks for a commit or PR, because AGENTS.md requires docs to change in the same change as code.
---

# Docs sync

AGENTS.md requires a feature's docs to change in the same change as its code.
This skill checks the current change against that rule. It reports each doc
that is now wrong or incomplete, then edits the docs to fix them. It never
changes code to match a doc.

`docs/superpowers/` and `.superpowers/` are local, gitignored specs and plans,
not project docs. Leave them out entirely: do not read them, check them, edit
them, list them in the report or link to them.

## 1. Scope the change

By default, the change is everything a PR from this branch would carry:
commits since the merge-base with `develop`, plus staged, unstaged and
untracked files. If the user names a commit, a range or "only uncommitted",
use that scope instead.

Run the helper script from the repo root:

```bash
.claude/skills/docs-sync/scripts/related-docs.sh
```

It lists the docs the change already touches and, for each changed code file,
each doc that names it by path, file name or module, marked `✓` if that doc is
part of the change and `·` if it is not. `--base <ref>` sets the base. On
`develop` itself the default scope is the working tree only, so use
`--base HEAD~1` for the last commit.

The script finds candidate docs. It does not decide whether a doc is stale. A
doc that names a file can still be right, and a doc that names nothing can
still be wrong. For example, a new route belongs on its feature page even when
no doc names the new controller yet. Read the diff itself with
`git diff <base>` and `git diff HEAD`, and read new files in full.

## 2. Work out what each change means for the docs

For each change, ask what a reader of the docs would now get wrong. Use the
table below to find where each kind of change is documented. A row applies
when the diff changes that behavior, even if no doc names the file.

| The diff changes…                                                                                 | Check                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A route, its request or response shape, or a shared Zod schema in `packages/shared/src/schemas/`  | The feature page's routes table and shape bullets                                                                                                                                    |
| `@ApiCodedError(...)` decorators, or a `*-errors.ts` file                                         | The feature page's **Errors** table. AGENTS.md says the table must match the decorators exactly: code, status, params and when.                                                      |
| A business rule, lifecycle, state machine, stock or money logic                                   | The feature page's **Rules**, plus any flow page beside it (`lifecycle.md`, `message-flow.md`, `connect-flow.md`, `sending-flow.md`, `request-pipeline.md`) and its Mermaid diagrams |
| A Drizzle table or column in `apps/api/src/modules/database/schema/`, or a migration              | The feature page's **Data model**                                                                                                                                                    |
| Roles, grants, RLS, policies, functions, triggers or extensions (usually a `db:custom` migration) | `docs/architecture/database.md`                                                                                                                                                      |
| An LLM prompt, an output schema, `llm.ts` schemas, or a turn's path through the assistant         | `docs/architecture/ai.md`. AGENTS.md requires it in the same change.                                                                                                                 |
| Assistant behavior inside a phase of feature 11                                                   | That phase's README (**What is built**, **Decisions**, **Tests**, **Follow-ups**, **Done when**) and `docs/features/11-ai-implementation/progress.md`                                |
| A new or renamed spec in `__tests__/`                                                             | The **Tests** or **Code and tests** table on the feature or phase page                                                                                                               |
| A new or moved file a page lists under **Key files** or **Code and tests**                        | That list, and every relative link to the old path                                                                                                                                   |
| A dashboard page, route under `apps/web/src/routes/`, or component in `apps/web/src/features/`    | The feature page's **Web** or **Dashboard** section                                                                                                                                  |
| An env var in `apps/api/src/modules/config/env.schema.ts`                                         | The matching `docs/setup/*.md` page, the feature page's **Configuration**, and `docs/architecture/deployment.md` if servers need it                                                  |
| A `package.json` script, a compose file, local URL or test setup                                  | The **Commands** table and notes in `AGENTS.md`, and `README.md`                                                                                                                     |
| Infra under `infra/`, `docker/` or `.github/workflows/`                                           | `docs/architecture/deployment.md`, and the Hosting and CI/CD rows of `tech-stack.md`                                                                                                 |
| A feature reaching "built", or a gap closing                                                      | The status line at the top of the feature page, the status column of `docs/features/README.md`, and its **MVP scope not yet built** list                                             |
| Something a page lists under **Not yet built**, **Follow-ups** or **Future improvements**         | Remove or reword that entry, on every page that lists it (see below)                                                                                                                 |

Also check these, whatever the diff touches:

- **Follow-ups the change completes.** AGENTS.md says to search every page
  for them, not just the feature's own page:
  `grep -rn -i -E -A12 "not yet built|follow-ups|future improvements" docs/features docs/architecture`
- **Dates.** Status lines say "(Oct 2026)" or "As of Oct 15, 2026". If you
  change what a status line says, update its date to today.
- **Progress ticks.** In `progress.md` and in each phase's **Done when**, tick
  an item only when someone has run it, not when the code exists. Code alone
  can move a phase to "Built", but leaves its manual runs unticked.
- **Other pages that state the same fact.** A status, a count or a "not
  built yet" claim often appears on several pages: a phase page and
  `progress.md`, a feature page and `docs/features/README.md`, or a "Known
  conflict" note on a parent page. When the change makes one of them true or
  false, search for the others (`grep -rn -i "<feature or phase name>" docs/features docs/architecture`)
  and make them agree.
- **Links.** Every relative link in a changed doc must resolve.
- **Config that nothing reads yet.** Document a new env var, setting or flag
  as soon as it is in the schema, even if no code uses it yet. Give its name,
  default and allowed values from the schema, and do not hold the edit. If
  nothing reads it, say so as a one-line note in the report, not under Needs a
  decision.
- **MVP docs.** `docs/mvp/` says what to build and is the source of truth. If
  the code disagrees with it, do not edit the MVP doc to match. Report the
  conflict and let the user decide.

## 3. Report

Write the report before you edit anything, so the user can see what was found
and what the fixes will be. Use this shape:

```markdown
## Docs sync: <base short sha>..working tree, <N> code files, <M> docs touched

### Out of date

- `docs/features/07-orders/README.md` § Errors. `orders.controller.ts` now
  declares `ORDER_LOCKED` (409, `{ id }`) on `POST /:id/status`, and the table
  does not list it.

### Missing

- `docs/architecture/ai.md`. `extractOrder` gained a `notes` field in
  `llm.ts`, and the output schema section does not show it.

### Completed follow-ups to remove

- `docs/features/README.md` § MVP scope not yet built: "CSV export of orders"
  is now built (`orders-export.controller.ts`).

### Needs a decision

- `docs/mvp/01-messenger-to-order/rules.md` says X, and the code now does Y.

### Checked, no change needed

- `docs/features/02-catalog/README.md`. It mentions `catalog.ts`, but the
  change only renamed a local variable.
```

Each finding names the doc and section, the code that proves it (file, and
symbol or line), and what is wrong. Leave out empty sections. If nothing is
out of date, say so in one line and list what you checked.

## 4. Fix

Then edit the docs for everything under Out of date, Missing and Completed
follow-ups. Leave Needs a decision alone. Follow the docs' own conventions:

- Write like the page around you. Use its section order, table columns,
  sentence style and level of detail. Pages are plain, factual and present
  tense. They say what the code does, not what changed.
- One fact lives in one place. If another page already explains it, link to
  that page rather than repeating it.
- Take every name, code, status, field and path from the code, never from
  memory. Open the file and copy the name.
- For a new or changed diagram, use the `design-doc-mermaid` skill.
- Run `pnpm format:check` (Prettier formats Markdown). If it fails on files
  you edited, run `pnpm exec prettier --write <files>`.

Finish with a short list of the files you edited and anything left under
Needs a decision. Do not commit unless the user asks.
