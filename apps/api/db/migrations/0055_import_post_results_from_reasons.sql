-- product_import_post.reason folds into result: a not_product or failed post
-- takes its reason as its result, and limits_applied becomes a flag.
UPDATE "product_import_post" SET "limits_applied" = true WHERE "reason" = 'limits_applied';
--> statement-breakpoint
UPDATE "product_import_post"
SET "result" = COALESCE("reason", 'not_a_product')
WHERE "result" = 'not_product';
--> statement-breakpoint
UPDATE "product_import_post"
SET "result" = CASE WHEN "reason" IN ('llm_failed', 'photo_unreadable', 'write_failed') THEN "reason" ELSE 'llm_failed' END
WHERE "result" = 'failed';
