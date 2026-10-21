CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"psid" text NOT NULL,
	"name" text,
	"picture_url" text,
	"profile_fetched_at" timestamp with time zone,
	"phone" text,
	"delivery_address" text,
	"area" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "customer_merchant_psid_uq" UNIQUE("merchant_id","psid")
);
--> statement-breakpoint
ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_name_trgm_idx" ON "customer" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "customer_merchant_isolation" ON "customer" AS PERMISSIVE FOR ALL TO public USING ("customer"."merchant_id" = app_current_merchant()) WITH CHECK ("customer"."merchant_id" = app_current_merchant());