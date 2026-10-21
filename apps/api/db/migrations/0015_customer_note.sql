CREATE TABLE "customer_note" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_customer_fk" FOREIGN KEY ("merchant_id","customer_id") REFERENCES "public"."customer"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_note_customer_idx" ON "customer_note" USING btree ("merchant_id","customer_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE POLICY "customer_note_merchant_isolation" ON "customer_note" AS PERMISSIVE FOR ALL TO public USING ("customer_note"."merchant_id" = app_current_merchant()) WITH CHECK ("customer_note"."merchant_id" = app_current_merchant());