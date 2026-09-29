# Database

Postgres objects that sit outside the plain table definitions: roles, grants,
row-level security, policies, functions, extensions and triggers. The tables
themselves are declared in `apps/api/src/database/schema/`; everything below is
as created by the migrations in `apps/api/db/migrations/`. When a migration changes
any of it, update this page in the same change.

How it fits together: the api and worker connect as `app_runtime`, a role that
cannot bypass row-level security. Every table carrying `merchant_id` has RLS
enabled **and forced**, with a policy comparing `merchant_id` to
`app_current_merchant()`. `withMerchant()` sets that context per transaction, so
a query that forgets its `merchant_id` filter returns nothing instead of another
seller's rows. RLS is the backstop — repositories still filter on `merchantId`.

## Roles

| Role                | Created in                                                                                         | Attributes                                                | Used by                                                                        | What it does                                                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner (admin)       | The `POSTGRES_USER` of the cluster                                                                 | Owns every table and migration-created object             | `DATABASE_ADMIN_URL` — `db:generate`, `db:migrate`, `db:verify-rls`, CI deploy | Applies migrations. Default privileges attach to it, so migrations must always run as this same role or new tables land ungranted. `FORCE ROW LEVEL SECURITY` binds it on tenant tables. Never given to the api or worker.                                                                                     |
| `app_runtime`       | Migration (NOLOGIN); `docker/postgres-init/01-app-runtime.sh` on a fresh volume (LOGIN + password) | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`         | `DATABASE_URL` — the api and worker                                            | The restricted runtime connection. Because it is not a superuser and has no `BYPASSRLS`, every policy applies to it. The migration creates it without a password so no credential is in git; each environment sets `LOGIN PASSWORD` once, out of band, or the init script does it from `APP_RUNTIME_PASSWORD`. |
| `app_page_resolver` | Migration                                                                                          | `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` | Nobody connects as it; owns `app_page_merchant()`                              | Lets the webhook worker map a Page id to a merchant before any merchant context exists. Can read only two columns of `facebook_page` through its own `SELECT` policy, so the function it owns does not depend on bypassing RLS.                                                                                |

## Grants and default privileges

| Grantee             | Privilege                                            | On                                                                  | Why                                                                                                          |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `app_runtime`       | `USAGE`                                              | schema `public`                                                     | Reach objects in the schema.                                                                                 |
| `app_runtime`       | `SELECT, INSERT, UPDATE, DELETE`                     | all tables existing when the role was created (Better Auth's seven) | Auth tables need grants but no policy — they carry no `merchant_id` and are read before a merchant is known. |
| `app_runtime`       | `USAGE, SELECT`                                      | all sequences existing when the role was created                    | Same, for sequences.                                                                                         |
| `app_runtime`       | `SELECT, INSERT, UPDATE, DELETE` (default privilege) | future tables created by the owner in `public`                      | New tables are reachable without a follow-up grant.                                                          |
| `app_runtime`       | `USAGE, SELECT` (default privilege)                  | future sequences created by the owner in `public`                   | Same, for sequences.                                                                                         |
| `app_runtime`       | `EXECUTE`                                            | `app_page_merchant(text)`                                           | The worker's only way to resolve a Page to a merchant.                                                       |
| `PUBLIC`            | `EXECUTE` **revoked**                                | `app_page_merchant(text)`                                           | A `SECURITY DEFINER` function must not be callable by every role.                                            |
| `app_page_resolver` | `USAGE`                                              | schema `public`                                                     | Reach `facebook_page`.                                                                                       |
| `app_page_resolver` | `SELECT (page_id, merchant_id)`                      | `facebook_page`                                                     | Column-level: it can never read `access_token`, `name` or anything else.                                     |

`app_current_merchant()` keeps the default `EXECUTE` for `PUBLIC`; it only reads
a setting.

## Functions

| Function                            | Returns | Properties                                                              | Owner               | What it does                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ------- | ----------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_current_merchant()`            | `text`  | `LANGUAGE sql STABLE`                                                   | Owner (admin)       | `NULLIF(current_setting('app.current_merchant', true), '')`. The tenant id every isolation policy compares against. `NULLIF` turns the empty string a pooled connection holds after a previous transaction into `NULL`, so an absent context matches no rows (fails closed). Returns `text` because `organization.id` is Better Auth's text id, not a UUID. |
| `app_page_merchant(p_page_id text)` | `text`  | `LANGUAGE sql STABLE SECURITY DEFINER`, `search_path = public, pg_temp` | `app_page_resolver` | `SELECT merchant_id FROM facebook_page WHERE page_id = p_page_id`. Returns the merchant for a Meta Page id, or `NULL` for a Page nobody connected. Runs as its owner, whose access is limited to two columns and one read policy. `search_path` is pinned as for any `SECURITY DEFINER` function.                                                           |

## Session settings

| Setting                | Set by                                                                                    | Scope             | What it does                                                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.current_merchant` | `withMerchant()` in `apps/api/src/database/with-merchant.ts`, via `set_config(..., true)` | Transaction-local | The merchant the current transaction acts for; read by `app_current_merchant()`. Transaction-local so one merchant's context never bleeds into the next request on a pooled connection. `withMerchant()` refuses an empty `merchantId`. |

## Row-level security by table

Every `merchant_id` table must be `ENABLE` + `FORCE` with at least one policy;
`pnpm --filter api db:verify-rls` fails otherwise. drizzle-kit emits `ENABLE`
and the policies but not `FORCE`, which is why each table has a follow-up custom
migration.

| Table                                                                                | `merchant_id` | RLS enabled | RLS forced | Policies                                                          |
| ------------------------------------------------------------------------------------ | ------------- | ----------- | ---------- | ----------------------------------------------------------------- |
| `category`                                                                           | yes           | yes         | yes        | `category_merchant_isolation`                                     |
| `product`                                                                            | yes           | yes         | yes        | `product_merchant_isolation`                                      |
| `product_category`                                                                   | yes           | yes         | yes        | `product_category_merchant_isolation`                             |
| `product_variant`                                                                    | yes           | yes         | yes        | `product_variant_merchant_isolation`                              |
| `product_image`                                                                      | yes           | yes         | yes        | `product_image_merchant_isolation`                                |
| `facebook_page`                                                                      | yes           | yes         | yes        | `facebook_page_merchant_isolation`, `facebook_page_resolver_read` |
| `customer`                                                                           | yes           | yes         | yes        | `customer_merchant_isolation`                                     |
| `conversation`                                                                       | yes           | yes         | yes        | `conversation_merchant_isolation`                                 |
| `message`                                                                            | yes           | yes         | yes        | `message_merchant_isolation`                                      |
| `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation` | no            | no          | no         | none — Better Auth tables, deliberately unprotected by RLS        |

## Policies

All isolation policies share one shape: `AS PERMISSIVE FOR ALL TO public`, with
`USING` and `WITH CHECK` both `<table>.merchant_id = app_current_merchant()`.
`USING` hides other merchants' rows from `SELECT`/`UPDATE`/`DELETE`; `WITH
CHECK` rejects an `INSERT` or `UPDATE` that would write a row for another
merchant. With no context set, both evaluate to `NULL` and nothing matches.

| Policy                                | Table              | Command  | Roles               | `USING`                                | `WITH CHECK`                           | What it does                                                                                                                                    |
| ------------------------------------- | ------------------ | -------- | ------------------- | -------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `category_merchant_isolation`         | `category`         | `ALL`    | `public`            | `merchant_id = app_current_merchant()` | `merchant_id = app_current_merchant()` | Confines categories to the current merchant.                                                                                                    |
| `product_merchant_isolation`          | `product`          | `ALL`    | `public`            | same                                   | same                                   | Confines products to the current merchant.                                                                                                      |
| `product_category_merchant_isolation` | `product_category` | `ALL`    | `public`            | same                                   | same                                   | Confines product↔category links to the current merchant.                                                                                        |
| `product_variant_merchant_isolation`  | `product_variant`  | `ALL`    | `public`            | same                                   | same                                   | Confines variants (price, stock, SKU) to the current merchant.                                                                                  |
| `product_image_merchant_isolation`    | `product_image`    | `ALL`    | `public`            | same                                   | same                                   | Confines image records to the current merchant.                                                                                                 |
| `facebook_page_merchant_isolation`    | `facebook_page`    | `ALL`    | `public`            | same                                   | same                                   | Confines the connected Page, including its encrypted access token, to the current merchant.                                                     |
| `facebook_page_resolver_read`         | `facebook_page`    | `SELECT` | `app_page_resolver` | `true`                                 | —                                      | Lets the resolver see every Page row; its column grant still limits it to `page_id` and `merchant_id`. Used only through `app_page_merchant()`. |
| `customer_merchant_isolation`         | `customer`         | `ALL`    | `public`            | `merchant_id = app_current_merchant()` | `merchant_id = app_current_merchant()` | Confines Messenger customers (PSID, name) to the current merchant.                                                                              |
| `conversation_merchant_isolation`     | `conversation`     | `ALL`    | `public`            | same                                   | same                                   | Confines conversations and their state to the current merchant.                                                                                 |
| `message_merchant_isolation`          | `message`          | `ALL`    | `public`            | same                                   | same                                   | Confines messages to the current merchant.                                                                                                      |

## Triggers

| Trigger | Table | Function | What it does                                                                                                                                          |
| ------- | ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| _None._ | —     | —        | No triggers exist. `updated_at` columns are set by the application, not by a trigger. A trigger would be authored with `pnpm --filter api db:custom`. |

## Extensions

| Extension  | Why                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `pgcrypto` | Kept available for `digest()` / `crypt()`. Not required for ids — `gen_random_uuid()` is built into Postgres 13+. |
| `pg_trgm`  | Trigram GIN indexes behind conversation search on `customer.name` and `message.text`.                             |

## Tenant-scoped foreign keys

Links between tenant tables are composite `(merchant_id, id)` keys, backed by a
`UNIQUE (merchant_id, id)` on each parent, so a row can never reference another
merchant's row even if RLS were off. Every tenant table also has a plain
`merchant_id → organization.id` key (`ON DELETE NO ACTION`).

| Constraint                     | From → To                                                          | On delete             | What it does                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `category_parent_fk`           | `category (merchant_id, parent_id)` → `category (merchant_id, id)` | `NO ACTION`           | A parent category belongs to the same merchant.                                                                                  |
| `product_category_product_fk`  | `product_category` → `product`                                     | `CASCADE`             | Deleting a product removes its category links.                                                                                   |
| `product_category_category_fk` | `product_category` → `category`                                    | `NO ACTION`           | A category in use cannot be hard-deleted (categories soft-delete via `deleted_at`).                                              |
| `product_variant_product_fk`   | `product_variant` → `product`                                      | `CASCADE`             | Deleting a product removes its variants.                                                                                         |
| `product_image_product_fk`     | `product_image` → `product`                                        | `CASCADE`             | Deleting a product removes its image records.                                                                                    |
| `product_variant_image_fk`     | `product_variant (merchant_id, image_id)` → `product_image`        | `SET NULL (image_id)` | Deleting an image clears only `image_id` on its variants. Column-list `SET NULL` (Postgres 15+) is why it is a custom migration. |
| `conversation_customer_fk`     | `conversation` → `customer`                                        | `NO ACTION`           | A conversation's customer belongs to the same merchant.                                                                          |
| `message_conversation_fk`      | `message` → `conversation`                                         | `CASCADE`             | Deleting a conversation removes its messages.                                                                                    |

## Check constraints

| Constraint                           | Table             | Rule                                                                                                          |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `category_not_own_parent_ck`         | `category`        | `parent_id` is null or differs from `id`.                                                                     |
| `product_status_ck`                  | `product`         | `status` in `draft`, `active`, `archived`.                                                                    |
| `product_delivery_charge_ck`         | `product`         | `delivery_charge >= 0` (minor units).                                                                         |
| `product_variant_price_ck`           | `product_variant` | `price >= 0` (minor units).                                                                                   |
| `product_variant_stock_ck`           | `product_variant` | `stock >= 0`.                                                                                                 |
| `product_variant_default_unnamed_ck` | `product_variant` | `is_default` exactly when `name` is null — the default variant is the unnamed one.                            |
| `conversation_state_ck`              | `conversation`    | `state` in `browsing`, `collecting_details`, `awaiting_confirmation`, `confirmed`, `handed_off`, `abandoned`. |
| `conversation_last_sender_ck`        | `conversation`    | `last_message_sender` in `customer`, `assistant`, `seller`.                                                   |
| `message_sender_ck`                  | `message`         | `sender` in `customer`, `assistant`, `seller`.                                                                |
| `message_status_ck`                  | `message`         | `status` in `sending`, `sent`, `failed`.                                                                      |

## Partial and special indexes

Ordinary b-tree indexes on `merchant_id`-leading columns are omitted; these are
the ones that encode a rule or need an extension.

| Index                                    | Table             | Definition                                                       | What it does                                                        |
| ---------------------------------------- | ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `category_merchant_name_live_uidx`       | `category`        | unique `(merchant_id, lower(name))` where `deleted_at is null`   | Category names are case-insensitively unique among live categories. |
| `product_variant_merchant_sku_live_uidx` | `product_variant` | unique `(merchant_id, sku)` where `archived_at is null`          | SKUs are unique per merchant among live variants.                   |
| `product_variant_default_live_uidx`      | `product_variant` | unique `(product_id)` where `is_default and archived_at is null` | At most one live default variant per product.                       |
| `conversation_needs_you_idx`             | `conversation`    | `(merchant_id)` where `state = 'handed_off'`                     | Serves the "needs you" inbox filter.                                |
| `conversation_drafted_idx`               | `conversation`    | `(merchant_id)` where `state = 'awaiting_confirmation'`          | Serves the drafted-order inbox filter.                              |
| `customer_name_trgm_idx`                 | `customer`        | GIN `(name gin_trgm_ops)`                                        | Substring search on customer names.                                 |
| `message_text_trgm_idx`                  | `message`         | GIN `(text gin_trgm_ops)`                                        | Substring search on message text.                                   |
