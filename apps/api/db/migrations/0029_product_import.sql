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
ALTER TABLE "product_import" ADD CONSTRAINT "product_import_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import" ADD CONSTRAINT "product_import_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_import_merchant_active_uidx" ON "product_import" USING btree ("merchant_id") WHERE "product_import"."status" in ('queued', 'running', 'stopping');--> statement-breakpoint
CREATE INDEX "product_import_merchant_created_idx" ON "product_import" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE POLICY "product_import_merchant_isolation" ON "product_import" AS PERMISSIVE FOR ALL TO public USING ("product_import"."merchant_id" = app_current_merchant()) WITH CHECK ("product_import"."merchant_id" = app_current_merchant());