CREATE TABLE "order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text,
	"variant_id" text,
	"product_name" text NOT NULL,
	"variant_name" text,
	"sku" text,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_order_position_uq" UNIQUE("merchant_id","order_id","position"),
	CONSTRAINT "order_item_quantity_ck" CHECK ("order_item"."quantity" > 0),
	CONSTRAINT "order_item_unit_price_ck" CHECK ("order_item"."unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."order"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_variant_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variant"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_item_variant_idx" ON "order_item" USING btree ("merchant_id","variant_id");--> statement-breakpoint
CREATE POLICY "order_item_merchant_isolation" ON "order_item" AS PERMISSIVE FOR ALL TO public USING ("order_item"."merchant_id" = app_current_merchant()) WITH CHECK ("order_item"."merchant_id" = app_current_merchant());