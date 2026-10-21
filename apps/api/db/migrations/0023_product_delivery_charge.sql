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
ALTER TABLE "product_delivery_charge" ADD CONSTRAINT "product_delivery_charge_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_delivery_charge" ADD CONSTRAINT "product_delivery_charge_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_delivery_charge" ADD CONSTRAINT "product_delivery_charge_delivery_charge_fk" FOREIGN KEY ("merchant_id","delivery_charge_id") REFERENCES "public"."delivery_charge"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "product_delivery_charge_merchant_isolation" ON "product_delivery_charge" AS PERMISSIVE FOR ALL TO public USING ("product_delivery_charge"."merchant_id" = app_current_merchant()) WITH CHECK ("product_delivery_charge"."merchant_id" = app_current_merchant());