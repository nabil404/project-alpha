CREATE TABLE "facebook_page" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"page_id" text NOT NULL,
	"name" text NOT NULL,
	"access_token" text NOT NULL,
	"bot_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facebook_page_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "facebook_page_page_id_uq" UNIQUE("page_id"),
	CONSTRAINT "facebook_page_merchant_uq" UNIQUE("merchant_id")
);
--> statement-breakpoint
ALTER TABLE "facebook_page" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "facebook_page" ADD CONSTRAINT "facebook_page_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "facebook_page_merchant_isolation" ON "facebook_page" AS PERMISSIVE FOR ALL TO public USING ("facebook_page"."merchant_id" = app_current_merchant()) WITH CHECK ("facebook_page"."merchant_id" = app_current_merchant());