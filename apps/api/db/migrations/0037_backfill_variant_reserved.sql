-- Drafted (`new`) orders now reserve their items' stock. Orders drafted
-- before this migration reserved nothing, so their quantities are reserved
-- here. If a variant's drafts already exceed its stock,
-- product_variant_reserved_stock_ck fails this migration: cancel those
-- drafts and run it again.
--
-- row_security off: a superuser owner is unaffected; any other owner errors
-- here instead of silently updating no rows under FORCE ROW LEVEL SECURITY.
SET row_security = off;
--> statement-breakpoint
UPDATE "product_variant" v SET "reserved" = d."quantity"
FROM (
  SELECT oi."merchant_id", oi."variant_id", sum(oi."quantity")::int AS "quantity"
  FROM "order_item" oi
  JOIN "order" o ON o."id" = oi."order_id" AND o."merchant_id" = oi."merchant_id"
  WHERE o."status" = 'new' AND oi."variant_id" IS NOT NULL
    AND oi."product_id" IS NOT NULL
  GROUP BY oi."merchant_id", oi."variant_id"
) d
WHERE v."id" = d."variant_id" AND v."merchant_id" = d."merchant_id";
--> statement-breakpoint
RESET row_security;
