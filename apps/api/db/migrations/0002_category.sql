CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_merchant_id_uq" UNIQUE("merchant_id","id")
);
--> statement-breakpoint
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_merchant_id_organization_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_merchant_name_live_uidx" ON "category" USING btree ("merchant_id",lower("name")) WHERE "category"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "category_merchant_isolation" ON "category" AS PERMISSIVE FOR ALL TO public USING ("category"."merchant_id" = app_current_merchant()) WITH CHECK ("category"."merchant_id" = app_current_merchant());