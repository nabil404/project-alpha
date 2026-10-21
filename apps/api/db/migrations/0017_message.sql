CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"sender" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"text" text NOT NULL,
	"details" jsonb,
	"meta_message_id" text,
	"payload" text,
	"status" text NOT NULL,
	"sent_at" timestamp (3) with time zone NOT NULL,
	"edited_text" text,
	"edited_at" timestamp (3) with time zone,
	"deleted_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_merchant_meta_message_id_uq" UNIQUE("merchant_id","meta_message_id"),
	CONSTRAINT "message_sender_ck" CHECK ("message"."sender" in ('customer', 'assistant', 'seller')),
	CONSTRAINT "message_status_ck" CHECK ("message"."status" in ('sending', 'sent', 'failed')),
	CONSTRAINT "message_kind_ck" CHECK ("message"."kind" in ('text', 'sticker', 'reaction', 'location', 'image', 'video', 'audio', 'file', 'share', 'other'))
);
--> statement-breakpoint
ALTER TABLE "message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_fk" FOREIGN KEY ("merchant_id","conversation_id") REFERENCES "public"."conversation"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_thread_idx" ON "message" USING btree ("merchant_id","conversation_id","sent_at","id");--> statement-breakpoint
CREATE INDEX "message_text_trgm_idx" ON "message" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "message_merchant_isolation" ON "message" AS PERMISSIVE FOR ALL TO public USING ("message"."merchant_id" = app_current_merchant()) WITH CHECK ("message"."merchant_id" = app_current_merchant());