CREATE TABLE "product_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text,
	"sku" text NOT NULL,
	"price" integer,
	"stock" integer,
	"reserved" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"image_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_variant_price_ck" CHECK ("product_variant"."price" >= 0),
	CONSTRAINT "product_variant_stock_ck" CHECK ("product_variant"."stock" >= 0),
	CONSTRAINT "product_variant_reserved_ck" CHECK ("product_variant"."reserved" >= 0),
	CONSTRAINT "product_variant_reserved_stock_ck" CHECK ("product_variant"."reserved" <= coalesce("product_variant"."stock", 0)),
	CONSTRAINT "product_variant_default_unnamed_ck" CHECK ("product_variant"."is_default" = ("product_variant"."name" is null))
);
--> statement-breakpoint
ALTER TABLE "product_variant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_merchant_sku_live_uidx" ON "product_variant" USING btree ("merchant_id","sku") WHERE "product_variant"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_default_live_uidx" ON "product_variant" USING btree ("product_id") WHERE "product_variant"."is_default" and "product_variant"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "product_variant_merchant_product_idx" ON "product_variant" USING btree ("merchant_id","product_id");--> statement-breakpoint
CREATE POLICY "product_variant_merchant_isolation" ON "product_variant" AS PERMISSIVE FOR ALL TO public USING ("product_variant"."merchant_id" = app_current_merchant()) WITH CHECK ("product_variant"."merchant_id" = app_current_merchant());