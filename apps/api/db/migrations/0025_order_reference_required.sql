ALTER TABLE "order" ALTER COLUMN "year" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ALTER COLUMN "reference" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_merchant_year_number_uq" UNIQUE("merchant_id","year","number");--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_merchant_reference_uq" UNIQUE("merchant_id","reference");