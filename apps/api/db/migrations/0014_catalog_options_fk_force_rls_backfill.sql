-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for the option
-- tables (0013_catalog_options) but not FORCE, so without this the table owner
-- would bypass them. db:verify-rls fails the build if one is missing.
ALTER TABLE "product_option" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_option_value" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_variant_option_value" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Composite, so a product cannot point at another merchant's image. SET NULL
-- names its column, as product_variant_image_fk (0006) does: a plain composite
-- SET NULL would null merchant_id too and fail its NOT NULL.
ALTER TABLE "product" ADD CONSTRAINT "product_cover_image_fk"
  FOREIGN KEY ("merchant_id", "cover_image_id")
  REFERENCES "product_image" ("merchant_id", "id") ON DELETE SET NULL ("cover_image_id");
--> statement-breakpoint
-- Until now position 0 was the cover; it stays the cover.
UPDATE "product" p SET "cover_image_id" = c."id"
FROM (
  SELECT DISTINCT ON ("product_id") "product_id", "merchant_id", "id"
  FROM "product_image"
  ORDER BY "product_id", "position", "created_at"
) c
WHERE c."product_id" = p."id" AND c."merchant_id" = p."merchant_id";
--> statement-breakpoint
-- Products sold as named variants get one option, "Variant", whose values are
-- those names, so every named live variant has exactly one value per option.
INSERT INTO "product_option" ("id", "merchant_id", "product_id", "name", "position")
SELECT gen_random_uuid()::text, "merchant_id", "product_id", 'Variant', 0
FROM "product_variant"
WHERE "archived_at" IS NULL AND "name" IS NOT NULL
GROUP BY "merchant_id", "product_id";
--> statement-breakpoint
INSERT INTO "product_option_value" ("id", "merchant_id", "option_id", "value", "position")
SELECT gen_random_uuid()::text, n."merchant_id", n."option_id", n."name",
  (row_number() OVER (PARTITION BY n."option_id" ORDER BY n."first_created", n."name") - 1)::int
FROM (
  SELECT v."merchant_id", o."id" AS "option_id", v."name", min(v."created_at") AS "first_created"
  FROM "product_variant" v
  JOIN "product_option" o ON o."merchant_id" = v."merchant_id" AND o."product_id" = v."product_id"
  WHERE v."archived_at" IS NULL AND v."name" IS NOT NULL
  GROUP BY v."merchant_id", o."id", v."name"
) n;
--> statement-breakpoint
INSERT INTO "product_variant_option_value" ("merchant_id", "variant_id", "option_id", "option_value_id")
SELECT v."merchant_id", v."id", o."id", ov."id"
FROM "product_variant" v
JOIN "product_option" o ON o."merchant_id" = v."merchant_id" AND o."product_id" = v."product_id"
JOIN "product_option_value" ov
  ON ov."merchant_id" = o."merchant_id" AND ov."option_id" = o."id" AND ov."value" = v."name"
WHERE v."archived_at" IS NULL AND v."name" IS NOT NULL;
