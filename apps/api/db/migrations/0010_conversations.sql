CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"psid" text NOT NULL,
	"name" text,
	"profile_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "customer_merchant_psid_uq" UNIQUE("merchant_id","psid")
);
--> statement-breakpoint
ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"facebook_page_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"state" text DEFAULT 'browsing' NOT NULL,
	"collected_slots" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bot_paused" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp (3) with time zone NOT NULL,
	"last_message_preview" text NOT NULL,
	"last_message_sender" text NOT NULL,
	"last_inbound_at" timestamp (3) with time zone,
	"seller_last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "conversation_merchant_page_customer_uq" UNIQUE("merchant_id","facebook_page_id","customer_id"),
	CONSTRAINT "conversation_state_ck" CHECK ("conversation"."state" in ('browsing', 'collecting_details', 'awaiting_confirmation', 'confirmed', 'handed_off', 'abandoned')),
	CONSTRAINT "conversation_last_sender_ck" CHECK ("conversation"."last_message_sender" in ('customer', 'assistant', 'seller'))
);
--> statement-breakpoint
ALTER TABLE "conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"sender" text NOT NULL,
	"text" text NOT NULL,
	"meta_message_id" text,
	"status" text NOT NULL,
	"sent_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_merchant_meta_message_id_uq" UNIQUE("merchant_id","meta_message_id"),
	CONSTRAINT "message_sender_ck" CHECK ("message"."sender" in ('customer', 'assistant', 'seller')),
	CONSTRAINT "message_status_ck" CHECK ("message"."status" in ('sending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_customer_fk" FOREIGN KEY ("merchant_id","customer_id") REFERENCES "public"."customer"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_fk" FOREIGN KEY ("merchant_id","conversation_id") REFERENCES "public"."conversation"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_name_trgm_idx" ON "customer" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "conversation_merchant_last_message_idx" ON "conversation" USING btree ("merchant_id","last_message_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversation_needs_you_idx" ON "conversation" USING btree ("merchant_id") WHERE "conversation"."state" = 'handed_off';--> statement-breakpoint
CREATE INDEX "conversation_drafted_idx" ON "conversation" USING btree ("merchant_id") WHERE "conversation"."state" = 'awaiting_confirmation';--> statement-breakpoint
CREATE INDEX "message_thread_idx" ON "message" USING btree ("merchant_id","conversation_id","sent_at","id");--> statement-breakpoint
CREATE INDEX "message_text_trgm_idx" ON "message" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "facebook_page_resolver_read" ON "facebook_page" AS PERMISSIVE FOR SELECT TO "app_page_resolver" USING (true);--> statement-breakpoint
CREATE POLICY "customer_merchant_isolation" ON "customer" AS PERMISSIVE FOR ALL TO public USING ("customer"."merchant_id" = app_current_merchant()) WITH CHECK ("customer"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "conversation_merchant_isolation" ON "conversation" AS PERMISSIVE FOR ALL TO public USING ("conversation"."merchant_id" = app_current_merchant()) WITH CHECK ("conversation"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "message_merchant_isolation" ON "message" AS PERMISSIVE FOR ALL TO public USING ("message"."merchant_id" = app_current_merchant()) WITH CHECK ("message"."merchant_id" = app_current_merchant());