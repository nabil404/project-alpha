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
ALTER TABLE "product_option_value" ADD CONSTRAINT "product_option_value_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value" ADD CONSTRAINT "product_option_value_option_fk" FOREIGN KEY ("merchant_id","option_id") REFERENCES "public"."product_option"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_option_value_merchant_option_idx" ON "product_option_value" USING btree ("merchant_id","option_id");--> statement-breakpoint
CREATE POLICY "product_option_value_merchant_isolation" ON "product_option_value" AS PERMISSIVE FOR ALL TO public USING ("product_option_value"."merchant_id" = app_current_merchant()) WITH CHECK ("product_option_value"."merchant_id" = app_current_merchant());