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
CREATE TABLE "order" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"number" integer NOT NULL,
	"customer_id" text NOT NULL,
	"conversation_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"subtotal" integer NOT NULL,
	"delivery_charge" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"delivery_address" text NOT NULL,
	"notes" text,
	"placed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_merchant_id_uq" UNIQUE("merchant_id","id"),
	CONSTRAINT "order_merchant_number_uq" UNIQUE("merchant_id","number"),
	CONSTRAINT "order_status_ck" CHECK ("order"."status" in ('new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled')),
	CONSTRAINT "order_number_ck" CHECK ("order"."number" > 0),
	CONSTRAINT "order_amounts_ck" CHECK ("order"."subtotal" >= 0 and "order"."delivery_charge" >= 0 and "order"."total" = "order"."subtotal" + "order"."delivery_charge")
);
--> statement-breakpoint
ALTER TABLE "order" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text,
	"variant_id" text,
	"product_name" text NOT NULL,
	"variant_name" text,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_order_position_uq" UNIQUE("merchant_id","order_id","position"),
	CONSTRAINT "order_item_quantity_ck" CHECK ("order_item"."quantity" > 0),
	CONSTRAINT "order_item_unit_price_ck" CHECK ("order_item"."unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "delivery_address" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_customer_fk" FOREIGN KEY ("merchant_id","customer_id") REFERENCES "public"."customer"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_customer_fk" FOREIGN KEY ("merchant_id","customer_id") REFERENCES "public"."customer"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_conversation_fk" FOREIGN KEY ("merchant_id","conversation_id") REFERENCES "public"."conversation"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."order"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_note_customer_idx" ON "customer_note" USING btree ("merchant_id","customer_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "order_customer_placed_idx" ON "order" USING btree ("merchant_id","customer_id","placed_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "order_merchant_placed_idx" ON "order" USING btree ("merchant_id","placed_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE POLICY "customer_note_merchant_isolation" ON "customer_note" AS PERMISSIVE FOR ALL TO public USING ("customer_note"."merchant_id" = app_current_merchant()) WITH CHECK ("customer_note"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "order_merchant_isolation" ON "order" AS PERMISSIVE FOR ALL TO public USING ("order"."merchant_id" = app_current_merchant()) WITH CHECK ("order"."merchant_id" = app_current_merchant());--> statement-breakpoint
CREATE POLICY "order_item_merchant_isolation" ON "order_item" AS PERMISSIVE FOR ALL TO public USING ("order_item"."merchant_id" = app_current_merchant()) WITH CHECK ("order_item"."merchant_id" = app_current_merchant());