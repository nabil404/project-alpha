CREATE TABLE "product_option" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_option_position_ck" CHECK ("product_option"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_option" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_option_value" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"option_id" text NOT NULL,
	"value" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_value_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_option_value_merchant_option_id_uq" UNIQUE("merchant_id","option_id","id"),
	CONSTRAINT "product_option_value_position_ck" CHECK ("product_option_value"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_option_value" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variant_option_value" (
	"merchant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"option_id" text NOT NULL,
	"option_value_id" text NOT NULL,
	CONSTRAINT "product_variant_option_value_pk" PRIMARY KEY("merchant_id","variant_id","option_id")
);
--> statement-breakpoint
ALTER TABLE "product_variant_option_value" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "cover_image_id" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value" ADD CONSTRAINT "product_option_value_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value" ADD CONSTRAINT "product_option_value_option_fk" FOREIGN KEY ("merchant_id","option_id") REFERENCES "public"."product_option"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_value" ADD CONSTRAINT "product_variant_option_value_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_value" ADD CONSTRAINT "product_variant_option_value_variant_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variant"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_value" ADD CONSTRAINT "product_variant_option_value_value_fk" FOREIGN KEY ("merchant_id","option_id","option_value_id") REFERENCES "public"."product_option_value"("merchant_id","option_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_option_merchant_product_idx" ON "product_option" USING btree ("merchant_id","product_id");--> statement-breakpoint
CREATE INDEX "product_option_value_merchant_option_idx" ON "product_option_value" USING btree ("merchant_id","option_id");--> statement-breakpoint
CREATE INDEX "product_variant_option_value_merchant_value_idx" ON "product_variant_option_value" USING btree ("merchant_id","option_value_id");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_revision_ck" CHECK ("product"."revision" >= 0);--> statement-breakpoint
CREATE POLICY "product_option_merchant_isolation" ON "product_option" AS PERMISSIVE FOR ALL TO public USING ("product_option"."merchant_id" = app_current_merchant()) WITH CHECK ("product_option"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "product_option_value_merchant_isolation" ON "product_option_value" AS PERMISSIVE FOR ALL TO public USING ("product_option_value"."merchant_id" = app_current_merchant()) WITH CHECK ("product_option_value"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "product_variant_option_value_merchant_isolation" ON "product_variant_option_value" AS PERMISSIVE FOR ALL TO public USING ("product_variant_option_value"."merchant_id" = app_current_merchant()) WITH CHECK ("product_variant_option_value"."merchant_id" = app_current_merchant());