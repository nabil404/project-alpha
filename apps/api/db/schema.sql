-- Desired state of the database. One sectioned file, in dependency order.
-- Atlas diffs this against the migration directory; never hand-edit migrations
-- and never apply DDL directly.
--
-- Sections:
--   1. extensions
--   2. auth        (generated with the Better Auth CLI - do not hand-edit)
--   3. tenancy     (organization = merchant)
--   4. pages
--   5. catalog
--   6. customers
--   7. conversations
--   8. orders
--
-- Money is stored as integer minor units (e.g. paisa/cents), never floats or
-- numeric. Every business table carries merchant_id.

-- =============================================================================
-- 1. extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 2. auth (Better Auth: user, session, account, verification, organization)
-- =============================================================================
-- Populated by `pnpm --filter api db:auth-schema` once Better Auth is wired to
-- a live database. Generated SQL is pasted here, then diffed by Atlas.

-- =============================================================================
-- 3. tenancy
-- =============================================================================
-- The Better Auth Organization plugin owns the organization table. Business
-- tables reference it through merchant_id.

-- =============================================================================
-- 4. pages
-- =============================================================================
-- Connected Facebook Page: encrypted token, bot on/off.

-- =============================================================================
-- 5. catalog
-- =============================================================================
-- Product and variant: name, aliases, price (minor units), images, stock
-- status, delivery charge.

-- =============================================================================
-- 6. customers
-- =============================================================================
-- Messenger PSID, name, phone, address.

-- =============================================================================
-- 7. conversations
-- =============================================================================
-- Conversation state, collected slots (jsonb, parsed with Zod on read), bot
-- paused flag; messages with direction, content, timestamps, Meta message ID.

-- =============================================================================
-- 8. orders
-- =============================================================================
-- Order and order_item: items, totals, delivery charge, status, notes, linked
-- conversation. Order creation is idempotent per confirmation.
