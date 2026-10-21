ALTER TABLE "product_import_post" DROP CONSTRAINT "product_import_post_result_ck";--> statement-breakpoint
ALTER TABLE "product_import_post" ADD COLUMN "limits_applied" boolean DEFAULT false NOT NULL;