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
ALTER TABLE "delivery_charge" ADD CONSTRAINT "delivery_charge_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_charge_merchant_area_uidx" ON "delivery_charge" USING btree ("merchant_id",lower("area_name")) WHERE not "delivery_charge"."is_fallback";--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_charge_merchant_fallback_uidx" ON "delivery_charge" USING btree ("merchant_id") WHERE "delivery_charge"."is_fallback";--> statement-breakpoint
CREATE POLICY "delivery_charge_merchant_isolation" ON "delivery_charge" AS PERMISSIVE FOR ALL TO public USING ("delivery_charge"."merchant_id" = app_current_merchant()) WITH CHECK ("delivery_charge"."merchant_id" = app_current_merchant());