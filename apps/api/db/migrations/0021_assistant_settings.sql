CREATE TABLE "assistant_settings" (
	"merchant_id" text PRIMARY KEY NOT NULL,
	"tone" text NOT NULL,
	"default_language" text NOT NULL,
	"notes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_settings_tone_ck" CHECK ("assistant_settings"."tone" in ('friendly', 'direct', 'formal')),
	CONSTRAINT "assistant_settings_default_language_ck" CHECK ("assistant_settings"."default_language" ~ '^([a-z]{2}|match)$'),
	CONSTRAINT "assistant_settings_notes_ck" CHECK (char_length("assistant_settings"."notes") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "assistant_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "assistant_settings_merchant_isolation" ON "assistant_settings" AS PERMISSIVE FOR ALL TO public USING ("assistant_settings"."merchant_id" = app_current_merchant()) WITH CHECK ("assistant_settings"."merchant_id" = app_current_merchant());