# 01 · Messenger-to-Order

This folder is the source of truth for this MVP's scope and rules.

Timeline: 12 weeks, solo developer, Sep 21 – Dec 11, 2026.

- [Scope](scope.md) — in scope and out of scope
- [Rules](rules.md) — non-negotiable rules and database rules
- [Domain](domain.md) — conversation states, order statuses, data model
- [Tech stack](../../architecture/tech-stack.md) — principles, chosen stack
- [Meta requirements](meta-requirements.md) — verification, App Review, compliance pages
- [Success metrics](success-metrics.md) — pilot targets

## Problem and goal

Sellers on Facebook Pages lose hours in Messenger answering the same questions,
collecting addresses, and copying orders into notebooks or spreadsheets. Orders
get lost and replies are slow.

**Goal:** turn Facebook/Messenger customer conversations into confirmed orders
with as little manual work as possible. Channel: Facebook Pages and Messenger
only.

## Core flow

Customer messages the Page → AI understands intent → AI identifies the product
from the seller's catalog → AI asks only for missing details → customer
explicitly confirms the order summary → order is created automatically → seller
sees it in the dashboard → seller fulfills it.

## Users

- **Seller** — owns a Facebook Page, signs up, connects the Page, manages
  catalog and orders.
- **Customer** — messages the Page in Messenger. Never uses our dashboard.
