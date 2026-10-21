CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"facebook_page_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"state" text DEFAULT 'browsing' NOT NULL,
	"collected_slots" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bot_paused" boolean DEFAULT false NOT NULL,
	"entry_source" text DEFAULT 'organic' NOT NULL,
	"handed_off_at" timestamp (3) with time zone,
	"last_message_at" timestamp (3) with time zone NOT NULL,
	"last_message_preview" text NOT NULL,
	"last_message_sender" text NOT NULL,
	"last_message_kind" text DEFAULT 'text' NOT NULL,
	"last_inbound_at" timestamp (3) with time zone,
	"seller_last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "conversation_merchant_page_customer_uq" UNIQUE("merchant_id","facebook_page_id","customer_id"),
	CONSTRAINT "conversation_state_ck" CHECK ("conversation"."state" in ('browsing', 'collecting_details', 'awaiting_confirmation', 'confirmed', 'handed_off', 'abandoned')),
	CONSTRAINT "conversation_entry_source_ck" CHECK ("conversation"."entry_source" in ('ad', 'link', 'get_started', 'organic')),
	CONSTRAINT "conversation_last_sender_ck" CHECK ("conversation"."last_message_sender" in ('customer', 'assistant', 'seller')),
	CONSTRAINT "conversation_last_kind_ck" CHECK ("conversation"."last_message_kind" in ('text', 'sticker', 'reaction', 'location', 'image', 'video', 'audio', 'file', 'share', 'other'))
);
--> statement-breakpoint
ALTER TABLE "conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_customer_fk" FOREIGN KEY ("merchant_id","customer_id") REFERENCES "public"."customer"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_merchant_last_message_idx" ON "conversation" USING btree ("merchant_id","last_message_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversation_needs_you_idx" ON "conversation" USING btree ("merchant_id") WHERE "conversation"."state" = 'handed_off';--> statement-breakpoint
CREATE INDEX "conversation_drafted_idx" ON "conversation" USING btree ("merchant_id") WHERE "conversation"."state" = 'awaiting_confirmation';--> statement-breakpoint
CREATE POLICY "conversation_merchant_isolation" ON "conversation" AS PERMISSIVE FOR ALL TO public USING ("conversation"."merchant_id" = app_current_merchant()) WITH CHECK ("conversation"."merchant_id" = app_current_merchant());