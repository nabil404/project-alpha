CREATE TABLE "product_image" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"position" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_image_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_image_storage_key_uq" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "product_image" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variant" ADD COLUMN "image_id" text;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_image_merchant_product_position_idx" ON "product_image" USING btree ("merchant_id","product_id","position");--> statement-breakpoint
CREATE POLICY "product_image_merchant_isolation" ON "product_image" AS PERMISSIVE FOR ALL TO public USING ("product_image"."merchant_id" = app_current_merchant()) WITH CHECK ("product_image"."merchant_id" = app_current_merchant());