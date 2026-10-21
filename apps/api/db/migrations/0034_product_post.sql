CREATE TABLE "product_post" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"post_id" text NOT NULL,
	"alias_id" text,
	"url" text,
	"caption" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_post_merchant_post_uq" UNIQUE("merchant_id","post_id"),
	CONSTRAINT "product_post_status_ck" CHECK ("product_post"."status" in ('linked', 'suggested'))
);
--> statement-breakpoint
ALTER TABLE "product_post" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_post" ADD CONSTRAINT "product_post_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_post" ADD CONSTRAINT "product_post_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_post_merchant_alias_idx" ON "product_post" USING btree ("merchant_id","alias_id");--> statement-breakpoint
CREATE INDEX "product_post_merchant_product_idx" ON "product_post" USING btree ("merchant_id","product_id");--> statement-breakpoint
CREATE POLICY "product_post_merchant_isolation" ON "product_post" AS PERMISSIVE FOR ALL TO public USING ("product_post"."merchant_id" = app_current_merchant()) WITH CHECK ("product_post"."merchant_id" = app_current_merchant());