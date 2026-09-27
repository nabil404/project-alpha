CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "category_not_own_parent_ck" CHECK ("category"."parent_id" is null or "category"."parent_id" <> "category"."id")
);
--> statement-breakpoint
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"delivery_charge" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_status_ck" CHECK ("product"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "product_delivery_charge_ck" CHECK ("product"."delivery_charge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_category" (
	"merchant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"category_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_category_pk" PRIMARY KEY("merchant_id","product_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "product_category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text,
	"sku" text NOT NULL,
	"price" integer NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_variant_price_ck" CHECK ("product_variant"."price" >= 0),
	CONSTRAINT "product_variant_stock_ck" CHECK ("product_variant"."stock" >= 0),
	CONSTRAINT "product_variant_default_unnamed_ck" CHECK ("product_variant"."is_default" = ("product_variant"."name" is null))
);
--> statement-breakpoint
ALTER TABLE "product_variant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_fk" FOREIGN KEY ("merchant_id","parent_id") REFERENCES "public"."category"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_category_fk" FOREIGN KEY ("merchant_id","category_id") REFERENCES "public"."category"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_merchant_name_live_uidx" ON "category" USING btree ("merchant_id",lower("name")) WHERE "category"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "category_merchant_parent_idx" ON "category" USING btree ("merchant_id","parent_id");--> statement-breakpoint
CREATE INDEX "product_merchant_status_idx" ON "product" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "product_merchant_created_idx" ON "product" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "product_category_merchant_category_idx" ON "product_category" USING btree ("merchant_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_merchant_sku_live_uidx" ON "product_variant" USING btree ("merchant_id","sku") WHERE "product_variant"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_default_live_uidx" ON "product_variant" USING btree ("product_id") WHERE "product_variant"."is_default" and "product_variant"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "product_variant_merchant_product_idx" ON "product_variant" USING btree ("merchant_id","product_id");--> statement-breakpoint
CREATE POLICY "category_merchant_isolation" ON "category" AS PERMISSIVE FOR ALL TO public USING ("category"."merchant_id" = app_current_merchant()) WITH CHECK ("category"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "product_merchant_isolation" ON "product" AS PERMISSIVE FOR ALL TO public USING ("product"."merchant_id" = app_current_merchant()) WITH CHECK ("product"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "product_category_merchant_isolation" ON "product_category" AS PERMISSIVE FOR ALL TO public USING ("product_category"."merchant_id" = app_current_merchant()) WITH CHECK ("product_category"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "product_variant_merchant_isolation" ON "product_variant" AS PERMISSIVE FOR ALL TO public USING ("product_variant"."merchant_id" = app_current_merchant()) WITH CHECK ("product_variant"."merchant_id" = app_current_merchant());