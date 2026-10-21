CREATE TABLE "product_category" (
	"merchant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"category_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_category_pk" PRIMARY KEY("merchant_id","product_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "product_category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_category_fk" FOREIGN KEY ("merchant_id","category_id") REFERENCES "public"."category"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_category_merchant_category_idx" ON "product_category" USING btree ("merchant_id","category_id");--> statement-breakpoint
CREATE POLICY "product_category_merchant_isolation" ON "product_category" AS PERMISSIVE FOR ALL TO public USING ("product_category"."merchant_id" = app_current_merchant()) WITH CHECK ("product_category"."merchant_id" = app_current_merchant());