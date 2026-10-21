CREATE TABLE "llm_call" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"conversation_id" text,
	"import_id" text,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_call_owner_ck" CHECK (num_nonnulls("llm_call"."conversation_id", "llm_call"."import_id") = 1),
	CONSTRAINT "llm_call_purpose_ck" CHECK ("llm_call"."purpose" in ('classify', 'extract', 'phrase', 'vision_match', 'post_import')),
	CONSTRAINT "llm_call_outcome_ck" CHECK ("llm_call"."outcome" in ('ok', 'timeout', 'provider_error', 'invalid_output'))
);
--> statement-breakpoint
ALTER TABLE "llm_call" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_conversation_fk" FOREIGN KEY ("merchant_id","conversation_id") REFERENCES "public"."conversation"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_import_fk" FOREIGN KEY ("merchant_id","import_id") REFERENCES "public"."product_import"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_call_merchant_created_idx" ON "llm_call" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_call_merchant_import_idx" ON "llm_call" USING btree ("merchant_id","import_id");--> statement-breakpoint
CREATE POLICY "llm_call_merchant_isolation" ON "llm_call" AS PERMISSIVE FOR ALL TO public USING ("llm_call"."merchant_id" = app_current_merchant()) WITH CHECK ("llm_call"."merchant_id" = app_current_merchant());