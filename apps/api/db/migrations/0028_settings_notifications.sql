CREATE TABLE "notification_preference" (
	"merchant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"new_order" boolean NOT NULL,
	"customer_waiting" boolean NOT NULL,
	"daily_summary" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_pk" PRIMARY KEY("merchant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "notification_preference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_preference_user_idx" ON "notification_preference" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "notification_preference_merchant_isolation" ON "notification_preference" AS PERMISSIVE FOR ALL TO public USING ("notification_preference"."merchant_id" = app_current_merchant()) WITH CHECK ("notification_preference"."merchant_id" = app_current_merchant());