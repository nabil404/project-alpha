CREATE TABLE "product_import_post" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"import_id" text NOT NULL,
	"post_id" text NOT NULL,
	"created_time" timestamp with time zone,
	"caption" text,
	"permalink_url" text,
	"photo_count" integer DEFAULT 0 NOT NULL,
	"result" text NOT NULL,
	"note" text,
	"limits_applied" boolean DEFAULT false NOT NULL,
	"anyway_status" text,
	"matched_product_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"suggested_category" text,
	"product_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"extracted" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_import_post_merchant_import_post_uq" UNIQUE("merchant_id","import_id","post_id"),
	CONSTRAINT "product_import_post_result_ck" CHECK ("product_import_post"."result" in ('draft', 'merged', 'not_a_product', 'no_caption_or_photo', 'no_named_product', 'in_catalog', 'already_imported', 'llm_failed', 'photo_unreadable', 'write_failed')),
	CONSTRAINT "product_import_post_anyway_status_ck" CHECK ("product_import_post"."anyway_status" in ('queued', 'no_product', 'failed')),
	CONSTRAINT "product_import_post_photo_count_ck" CHECK ("product_import_post"."photo_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_import_post" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_import_post" ADD CONSTRAINT "product_import_post_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_post" ADD CONSTRAINT "product_import_post_import_fk" FOREIGN KEY ("merchant_id","import_id") REFERENCES "public"."product_import"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_import_post_merchant_post_idx" ON "product_import_post" USING btree ("merchant_id","post_id");--> statement-breakpoint
CREATE INDEX "product_import_post_merchant_import_created_idx" ON "product_import_post" USING btree ("merchant_id","import_id","created_at");--> statement-breakpoint
CREATE POLICY "product_import_post_merchant_isolation" ON "product_import_post" AS PERMISSIVE FOR ALL TO public USING ("product_import_post"."merchant_id" = app_current_merchant()) WITH CHECK ("product_import_post"."merchant_id" = app_current_merchant());