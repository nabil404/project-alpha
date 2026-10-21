CREATE TABLE "order_event" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_event_type_ck" CHECK ("order_event"."type" in ('created', 'status_changed', 'items_changed', 'delivery_changed', 'payment_changed', 'tracking_changed')),
	CONSTRAINT "order_event_data_type_ck" CHECK ("order_event"."data" ->> 'type' = "order_event"."type")
);
--> statement-breakpoint
ALTER TABLE "order_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."order"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_event_order_idx" ON "order_event" USING btree ("merchant_id","order_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE POLICY "order_event_merchant_isolation" ON "order_event" AS PERMISSIVE FOR ALL TO public USING ("order_event"."merchant_id" = app_current_merchant()) WITH CHECK ("order_event"."merchant_id" = app_current_merchant());