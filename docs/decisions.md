# Considered and not chosen

Alternatives evaluated during the stack decision and rejected, with the reason.
`AGENTS.md` links here; read it before proposing any of these again.

| Option                  | Why not                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| CrewAI                  | Python-only, and multi-agent overhead we don't need.                                      |
| Clerk                   | User data stored externally; all user data must stay in our own database.                 |
| Keycloak                | A separate Java server to operate, with higher RAM than the VPS budget allows.            |
| Passport                | Session assumptions clash with our design, and strategy maintenance is limited.           |
| Arctic                  | Deprecated by its author.                                                                 |
| pg-boss                 | BullMQ preferred.                                                                         |
| Prisma                  | Replaced by Kysely for SQL control, built-in row locking, and native Better Auth support. |
| TypeORM                 | Better Auth support only through a small community adapter.                               |
| Per-module schema files | Extra build step and an ordering file; one sectioned `schema.sql` is enough.              |
| Next.js                 | An unneeded server layer once NestJS owns the backend.                                    |
| Anthropic SDK alone     | Replaced by the AI SDK for provider independence.                                         |
