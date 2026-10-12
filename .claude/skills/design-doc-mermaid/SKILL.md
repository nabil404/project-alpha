---
name: design-doc-mermaid
description: Create Mermaid diagrams (flowchart, sequence, class, ER, state, architecture) for this repo's Markdown docs, from a description or from source code. Use when asked to draw, add or fix a diagram, document a flow or architecture, or turn code into a diagram.
---

# Mermaid diagrams for the docs

The docs are GitHub Markdown, so a diagram ships as a fenced `mermaid` block
inside the page it explains. GitHub renders the fence; do not write `.mmd`
files, PNGs, SVGs or a `diagrams/` folder.

## Where a diagram goes

- A built feature's diagram goes on that feature's page under
  `docs/features/<nn>-<name>/` — inline in its `README.md`, or in a sibling
  page linked from it when the diagram needs its own explanation (for
  example `docs/features/01-auth/request-pipeline.md`).
- Architecture-wide diagrams go under `docs/architecture/`.
- Draw from the code as it is, not as the MVP docs plan it. Name real classes,
  guards, queues, tables and error codes so the diagram can be checked against
  the source.

## Pick the type, then load one guide

| What the diagram shows | Mermaid type | Guide |
|---|---|---|
| A request crossing services, a webhook, a queue job, an auth handshake | `sequenceDiagram` | `references/guides/diagrams/sequence-diagrams.md` |
| A pipeline, decision path or process (guard chain, extraction flow) | `flowchart TD` | `references/guides/diagrams/activity-diagrams.md` |
| Modules, containers and how they connect | `flowchart` with `subgraph`s | `references/guides/diagrams/architecture-diagrams.md` |
| Servers, compose services, AWS stacks | `flowchart` with `subgraph`s | `references/guides/diagrams/deployment-diagrams.md` |
| Order, conversation or stock lifecycle | `stateDiagram-v2` | `troubleshooting.md` (State Diagrams) |
| Tables and relations | `erDiagram` | `troubleshooting.md` (ER Diagrams) |
| Deriving any of the above from code | — | `references/guides/code-to-diagram/README.md`, plus `examples/node-webapp/` (API) or `examples/react/` (web) |

Read only the guide you need. `references/guides/unicode-symbols/guide.md`
lists emoji by meaning if you want more than the set below.

**GitHub caveat:** C4 (`C4Context` …), `architecture-beta` and `block-beta`
render unreliably on GitHub. Use `flowchart` with `subgraph`s instead.

## House style

Match `docs/features/01-auth/request-pipeline.md`:

- One concept per diagram. Split rather than cram.
- Labels carry the real names: `["🔐 SessionGuard<br/>loads Better Auth session"]`.
- Failure paths are dotted edges to a rejection node naming the status and
  error code: `-. no session .-> r401[/"❌ 401 AUTH_UNAUTHENTICATED"/]`.
- Emoji sparingly, one per node at most: 🌐 entry, 🔐 auth/guard, ⚙️ handler,
  💾 database, ⚡ cache/Redis, 📬 queue, 🤖 LLM, ❌ rejection, ✅ success.
- Every `classDef` sets `color:` — light fill, dark text:

```
classDef entry    fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
classDef guard    fill:#87CEEB,stroke:#333,stroke-width:2px,color:#00008B
classDef decision fill:#FFD700,stroke:#333,stroke-width:2px,color:#000
classDef work     fill:#90EE90,stroke:#333,stroke-width:2px,color:#006400
classDef store    fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
classDef reject   fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:#000
```

## Validate before you finish

Render every fence in the page; the command exits 1 and prints the parse
error if any diagram is broken. The first run downloads mermaid-cli and a
headless Chromium. Write the output to the scratchpad, never into the repo.

```bash
npx -y -p @mermaid-js/mermaid-cli mmdc -i docs/features/<page>.md -o "$TMPDIR/out.md"
```

On a parse error, look it up in `references/guides/troubleshooting.md`
(reserved words such as `end`, unquoted `()`/`{}` in labels, missing `:` in
sequence messages, and similar), fix, and render again. Do not commit a
diagram that has not rendered cleanly.

## Files

```
design-doc-mermaid/
├── SKILL.md
├── references/guides/
│   ├── diagrams/            sequence, activity, architecture, deployment
│   ├── code-to-diagram/     reading a codebase into diagrams
│   ├── unicode-symbols/     emoji by meaning
│   └── troubleshooting.md   parse errors and fixes, per diagram type
└── examples/
    ├── node-webapp/         Express-style API: middleware, routes, async
    └── react/               component tree, state, data flow
```
