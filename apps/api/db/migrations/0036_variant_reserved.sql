ALTER TABLE "product_variant" ADD COLUMN "reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_reserved_ck" CHECK ("product_variant"."reserved" >= 0);--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_reserved_stock_ck" CHECK ("product_variant"."reserved" <= "product_variant"."stock");