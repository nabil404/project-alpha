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
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_option_merchant_product_idx" ON "product_option" USING btree ("merchant_id","product_id");--> statement-breakpoint
CREATE POLICY "product_option_merchant_isolation" ON "product_option" AS PERMISSIVE FOR ALL TO public USING ("product_option"."merchant_id" = app_current_merchant()) WITH CHECK ("product_option"."merchant_id" = app_current_merchant());