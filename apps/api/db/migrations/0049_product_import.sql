CREATE TABLE "product_import" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"source" text NOT NULL,
	"since" date NOT NULL,
	"until" date NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"started_by" text,
	"cursor" text,
	"posts_total" integer,
	"posts_read" integer DEFAULT 0 NOT NULL,
	"drafts" integer DEFAULT 0 NOT NULL,
	"merged" integer DEFAULT 0 NOT NULL,
	"not_products" integer DEFAULT 0 NOT NULL,
	"in_catalog" integer DEFAULT 0 NOT NULL,
	"already_imported" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"llm_failures_in_row" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_import_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_import_source_ck" CHECK ("product_import"."source" in ('facebook_posts')),
	CONSTRAINT "product_import_status_ck" CHECK ("product_import"."status" in ('queued', 'running', 'stopping', 'stopped', 'finished', 'failed')),
	CONSTRAINT "product_import_range_ck" CHECK ("product_import"."since" <= "product_import"."until")
);
--> statement-breakpoint
ALTER TABLE "product_import" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
	"reason" text,
	"matched_product_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"suggested_category" text,
	"product_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"extracted" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_import_post_merchant_import_post_uq" UNIQUE("merchant_id","import_id","post_id"),
	CONSTRAINT "product_import_post_result_ck" CHECK ("product_import_post"."result" in ('draft', 'merged', 'not_product', 'in_catalog', 'already_imported', 'failed')),
	CONSTRAINT "product_import_post_photo_count_ck" CHECK ("product_import_post"."photo_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_import_post" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variant" DROP CONSTRAINT "product_variant_reserved_stock_ck";--> statement-breakpoint
ALTER TABLE "llm_call" DROP CONSTRAINT "llm_call_purpose_ck";--> statement-breakpoint
ALTER TABLE "product_variant" ALTER COLUMN "price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variant" ALTER COLUMN "stock" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "product_variant" ALTER COLUMN "stock" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_call" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "import_finished" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_call" ADD COLUMN "import_id" text;--> statement-breakpoint
ALTER TABLE "product_import" ADD CONSTRAINT "product_import_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import" ADD CONSTRAINT "product_import_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_post" ADD CONSTRAINT "product_import_post_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_post" ADD CONSTRAINT "product_import_post_import_fk" FOREIGN KEY ("merchant_id","import_id") REFERENCES "public"."product_import"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_import_merchant_active_uidx" ON "product_import" USING btree ("merchant_id") WHERE "product_import"."status" in ('queued', 'running', 'stopping');--> statement-breakpoint
CREATE INDEX "product_import_merchant_created_idx" ON "product_import" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "product_import_post_merchant_post_idx" ON "product_import_post" USING btree ("merchant_id","post_id");--> statement-breakpoint
CREATE INDEX "product_import_post_merchant_import_created_idx" ON "product_import_post" USING btree ("merchant_id","import_id","created_at");--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_import_fk" FOREIGN KEY ("merchant_id","import_id") REFERENCES "public"."product_import"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_call_merchant_import_idx" ON "llm_call" USING btree ("merchant_id","import_id");--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_reserved_stock_ck" CHECK ("product_variant"."reserved" <= coalesce("product_variant"."stock", 0));--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_owner_ck" CHECK (num_nonnulls("llm_call"."conversation_id", "llm_call"."import_id") = 1);--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_purpose_ck" CHECK ("llm_call"."purpose" in ('classify', 'extract', 'phrase', 'vision_match', 'post_import'));--> statement-breakpoint
CREATE POLICY "product_import_merchant_isolation" ON "product_import" AS PERMISSIVE FOR ALL TO public USING ("product_import"."merchant_id" = app_current_merchant()) WITH CHECK ("product_import"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "product_import_post_merchant_isolation" ON "product_import_post" AS PERMISSIVE FOR ALL TO public USING ("product_import_post"."merchant_id" = app_current_merchant()) WITH CHECK ("product_import_post"."merchant_id" = app_current_merchant());