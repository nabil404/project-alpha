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
ALTER TABLE "order" DROP CONSTRAINT "order_status_ck";--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "source" text DEFAULT 'assistant' NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "payment_status" text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "payment_method" text DEFAULT 'cash_on_delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "delivery_zone" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."order"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_event_order_idx" ON "order_event" USING btree ("merchant_id","order_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."product"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_variant_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variant"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_merchant_status_placed_idx" ON "order" USING btree ("merchant_id","status","placed_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "order_item_variant_idx" ON "order_item" USING btree ("merchant_id","variant_id");--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_merchant_idempotency_key_uq" UNIQUE("merchant_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_source_ck" CHECK ("order"."source" in ('assistant', 'seller'));--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_payment_status_ck" CHECK ("order"."payment_status" in ('unpaid', 'paid', 'refunded'));--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_payment_method_ck" CHECK ("order"."payment_method" in ('cash_on_delivery', 'bank_transfer', 'mobile_wallet'));--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_revision_ck" CHECK ("order"."revision" >= 0);--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_status_ck" CHECK ("order"."status" in ('new', 'confirmed', 'packed', 'shipped', 'delivered', 'returned', 'cancelled'));--> statement-breakpoint
CREATE POLICY "order_event_merchant_isolation" ON "order_event" AS PERMISSIVE FOR ALL TO public USING ("order_event"."merchant_id" = app_current_merchant()) WITH CHECK ("order_event"."merchant_id" = app_current_merchant());