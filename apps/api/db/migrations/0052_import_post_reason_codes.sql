-- product_import_post.reason held English phrases, codes and the reader's own
-- words in one column. It becomes a code; the reader's words move to note.
UPDATE "product_import_post"
SET "note" = CASE WHEN "reason" = 'Not a product' THEN NULL ELSE "reason" END,
    "reason" = 'not_a_product'
WHERE "result" = 'not_product'
  AND "reason" IS NOT NULL
  AND "reason" NOT IN ('No caption or photo', 'No product with a name');
--> statement-breakpoint
UPDATE "product_import_post" SET "reason" = 'no_caption_or_photo' WHERE "reason" = 'No caption or photo';
--> statement-breakpoint
UPDATE "product_import_post" SET "reason" = 'no_named_product' WHERE "reason" = 'No product with a name';
--> statement-breakpoint
UPDATE "product_import_post" SET "reason" = 'not_a_product' WHERE "result" = 'not_product' AND "reason" IS NULL;
--> statement-breakpoint
UPDATE "product_import_post" SET "reason" = NULL
WHERE "reason" NOT IN ('not_a_product', 'no_caption_or_photo', 'no_named_product', 'limits_applied', 'llm_failed', 'photo_unreadable', 'write_failed');
