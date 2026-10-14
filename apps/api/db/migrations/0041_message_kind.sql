ALTER TABLE "message" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "edited_text" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "edited_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "deleted_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_kind_ck" CHECK ("message"."kind" in ('text', 'sticker', 'reaction', 'location', 'image', 'video', 'audio', 'file', 'other'));