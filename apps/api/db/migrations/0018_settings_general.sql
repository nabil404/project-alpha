CREATE TABLE "merchant_settings" (
	"merchant_id" text PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"time_zone" text NOT NULL,
	"date_format" text NOT NULL,
	"contact_phone" text,
	"pickup_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_settings_country_ck" CHECK ("merchant_settings"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "merchant_settings_currency_ck" CHECK ("merchant_settings"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "merchant_settings_date_format_ck" CHECK ("merchant_settings"."date_format" in ('d MMM yyyy', 'MMM d, yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'dd.MM.yyyy', 'yyyy-MM-dd')),
	CONSTRAINT "merchant_settings_contact_phone_ck" CHECK ("merchant_settings"."contact_phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "merchant_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "currency" text NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_settings" ADD CONSTRAINT "merchant_settings_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_currency_ck" CHECK ("order"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
CREATE POLICY "merchant_settings_merchant_isolation" ON "merchant_settings" AS PERMISSIVE FOR ALL TO public USING ("merchant_settings"."merchant_id" = app_current_merchant()) WITH CHECK ("merchant_settings"."merchant_id" = app_current_merchant());