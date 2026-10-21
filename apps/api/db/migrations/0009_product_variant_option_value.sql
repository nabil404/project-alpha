CREATE TABLE "product_variant_option_value" (
	"merchant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"option_id" text NOT NULL,
	"option_value_id" text NOT NULL,
	CONSTRAINT "product_variant_option_value_pk" PRIMARY KEY("merchant_id","variant_id","option_id")
);
--> statement-breakpoint
ALTER TABLE "product_variant_option_value" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variant_option_value" ADD CONSTRAINT "product_variant_option_value_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_value" ADD CONSTRAINT "product_variant_option_value_variant_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variant"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_value" ADD CONSTRAINT "product_variant_option_value_value_fk" FOREIGN KEY ("merchant_id","option_id","option_value_id") REFERENCES "public"."product_option_value"("merchant_id","option_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_variant_option_value_merchant_value_idx" ON "product_variant_option_value" USING btree ("merchant_id","option_value_id");--> statement-breakpoint
CREATE POLICY "product_variant_option_value_merchant_isolation" ON "product_variant_option_value" AS PERMISSIVE FOR ALL TO public USING ("product_variant_option_value"."merchant_id" = app_current_merchant()) WITH CHECK ("product_variant_option_value"."merchant_id" = app_current_merchant());