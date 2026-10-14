CREATE TABLE "ad_product" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"page_id" text NOT NULL,
	"ad_id" text NOT NULL,
	"product_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"chat_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ad_product_merchant_ad_uq" UNIQUE("merchant_id","ad_id")
);
--> statement-breakpoint
ALTER TABLE "ad_product" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "facebook_page" ADD COLUMN "profile_sync_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facebook_page" ADD COLUMN "profile_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facebook_page" ADD COLUMN "profile_sync_error" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "entry_source" text DEFAULT 'organic' NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "entry_source" text;--> statement-breakpoint
ALTER TABLE "merchant_settings" ADD COLUMN "messenger_greeting" text;--> statement-breakpoint
ALTER TABLE "merchant_settings" ADD COLUMN "ice_breakers" jsonb;--> statement-breakpoint
ALTER TABLE "ad_product" ADD CONSTRAINT "ad_product_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_entry_source_ck" CHECK ("conversation"."entry_source" in ('ad', 'link', 'get_started', 'organic'));--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_entry_source_ck" CHECK ("order"."entry_source" in ('ad', 'link', 'get_started', 'organic'));--> statement-breakpoint
CREATE POLICY "ad_product_merchant_isolation" ON "ad_product" AS PERMISSIVE FOR ALL TO public USING ("ad_product"."merchant_id" = app_current_merchant()) WITH CHECK ("ad_product"."merchant_id" = app_current_merchant());