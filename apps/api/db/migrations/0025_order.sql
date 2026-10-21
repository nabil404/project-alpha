CREATE TABLE "order" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"number" integer NOT NULL,
	"year" integer NOT NULL,
	"reference" text NOT NULL,
	"customer_id" text NOT NULL,
	"conversation_id" text,
	"source" text DEFAULT 'assistant' NOT NULL,
	"entry_source" text,
	"status" text DEFAULT 'new' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"payment_method" text DEFAULT 'cash_on_delivery' NOT NULL,
	"subtotal" integer NOT NULL,
	"delivery_fee" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"currency" text NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"delivery_address" text NOT NULL,
	"delivery_area" text,
	"delivery_charge_id" text,
	"delivery_everywhere_else" boolean DEFAULT false NOT NULL,
	"delivery_time" text,
	"tracking_number" text,
	"notes" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"placed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "order_merchant_year_number_uq" UNIQUE("merchant_id","year","number"),
	CONSTRAINT "order_merchant_reference_uq" UNIQUE("merchant_id","reference"),
	CONSTRAINT "order_merchant_idempotency_key_uq" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "order_status_ck" CHECK ("order"."status" in ('new', 'confirmed', 'packed', 'shipped', 'delivered', 'returned', 'cancelled')),
	CONSTRAINT "order_source_ck" CHECK ("order"."source" in ('assistant', 'seller')),
	CONSTRAINT "order_entry_source_ck" CHECK ("order"."entry_source" in ('ad', 'link', 'get_started', 'organic')),
	CONSTRAINT "order_payment_status_ck" CHECK ("order"."payment_status" in ('unpaid', 'paid', 'refunded')),
	CONSTRAINT "order_payment_method_ck" CHECK ("order"."payment_method" in ('cash_on_delivery', 'bank_transfer', 'mobile_wallet')),
	CONSTRAINT "order_number_ck" CHECK ("order"."number" > 0),
	CONSTRAINT "order_revision_ck" CHECK ("order"."revision" >= 0),
	CONSTRAINT "order_currency_ck" CHECK ("order"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "order_amounts_ck" CHECK ("order"."subtotal" >= 0 and "order"."delivery_fee" >= 0 and "order"."total" = "order"."subtotal" + "order"."delivery_fee")
);
--> statement-breakpoint
ALTER TABLE "order" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_customer_fk" FOREIGN KEY ("merchant_id","customer_id") REFERENCES "public"."customer"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_conversation_fk" FOREIGN KEY ("merchant_id","conversation_id") REFERENCES "public"."conversation"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_customer_placed_idx" ON "order" USING btree ("merchant_id","customer_id","placed_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "order_merchant_placed_idx" ON "order" USING btree ("merchant_id","placed_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "order_conversation_placed_idx" ON "order" USING btree ("merchant_id","conversation_id","placed_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "order_delivery_charge_idx" ON "order" USING btree ("merchant_id","delivery_charge_id");--> statement-breakpoint
CREATE INDEX "order_merchant_status_placed_idx" ON "order" USING btree ("merchant_id","status","placed_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE POLICY "order_merchant_isolation" ON "order" AS PERMISSIVE FOR ALL TO public USING ("order"."merchant_id" = app_current_merchant()) WITH CHECK ("order"."merchant_id" = app_current_merchant());