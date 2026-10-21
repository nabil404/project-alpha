CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"custom_delivery" boolean DEFAULT false NOT NULL,
	"cover_image_id" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_status_ck" CHECK ("product"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "product_revision_ck" CHECK ("product"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_merchant_status_idx" ON "product" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "product_merchant_created_idx" ON "product" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE POLICY "product_merchant_isolation" ON "product" AS PERMISSIVE FOR ALL TO public USING ("product"."merchant_id" = app_current_merchant()) WITH CHECK ("product"."merchant_id" = app_current_merchant());