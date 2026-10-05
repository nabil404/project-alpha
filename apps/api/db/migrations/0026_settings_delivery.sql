CREATE TABLE "delivery_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"area_name" text,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"charge" integer NOT NULL,
	"delivery_time" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_charge_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "delivery_charge_area_name_ck" CHECK (("delivery_charge"."area_name" is null) = "delivery_charge"."is_fallback"),
	CONSTRAINT "delivery_charge_charge_ck" CHECK ("delivery_charge"."charge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "delivery_charge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_delivery_charge" (
	"merchant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"delivery_charge_id" text NOT NULL,
	"charge" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_delivery_charge_pk" PRIMARY KEY("product_id","delivery_charge_id"),
	CONSTRAINT "product_delivery_charge_charge_ck" CHECK ("product_delivery_charge"."charge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_delivery_charge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order" RENAME COLUMN "delivery_charge" TO "delivery_fee";--> statement-breakpoint
ALTER TABLE "order" RENAME COLUMN "delivery_zone" TO "delivery_area";--> statement-breakpoint
ALTER TABLE "product" DROP CONSTRAINT "product_delivery_charge_ck";--> statement-breakpoint
ALTER TABLE "order" DROP CONSTRAINT "order_amounts_ck";--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "custom_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "delivery_charge_id" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "delivery_everywhere_else" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "delivery_time" text;--> statement-breakpoint
ALTER TABLE "merchant_settings" ADD COLUMN "free_delivery_over" integer;--> statement-breakpoint
ALTER TABLE "delivery_charge" ADD CONSTRAINT "delivery_charge_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_delivery_charge" ADD CONSTRAINT "product_delivery_charge_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_delivery_charge" ADD CONSTRAINT "product_delivery_charge_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_delivery_charge" ADD CONSTRAINT "product_delivery_charge_delivery_charge_fk" FOREIGN KEY ("merchant_id","delivery_charge_id") REFERENCES "public"."delivery_charge"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_charge_merchant_area_uidx" ON "delivery_charge" USING btree ("merchant_id",lower("area_name")) WHERE not "delivery_charge"."is_fallback";--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_charge_merchant_fallback_uidx" ON "delivery_charge" USING btree ("merchant_id") WHERE "delivery_charge"."is_fallback";--> statement-breakpoint
CREATE INDEX "order_delivery_charge_idx" ON "order" USING btree ("merchant_id","delivery_charge_id");--> statement-breakpoint
ALTER TABLE "product" DROP COLUMN "delivery_charge";--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_amounts_ck" CHECK ("order"."subtotal" >= 0 and "order"."delivery_fee" >= 0 and "order"."total" = "order"."subtotal" + "order"."delivery_fee");--> statement-breakpoint
ALTER TABLE "merchant_settings" ADD CONSTRAINT "merchant_settings_free_delivery_over_ck" CHECK ("merchant_settings"."free_delivery_over" >= 0);--> statement-breakpoint
CREATE POLICY "delivery_charge_merchant_isolation" ON "delivery_charge" AS PERMISSIVE FOR ALL TO public USING ("delivery_charge"."merchant_id" = app_current_merchant()) WITH CHECK ("delivery_charge"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "product_delivery_charge_merchant_isolation" ON "product_delivery_charge" AS PERMISSIVE FOR ALL TO public USING ("product_delivery_charge"."merchant_id" = app_current_merchant()) WITH CHECK ("product_delivery_charge"."merchant_id" = app_current_merchant());