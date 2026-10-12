ALTER TABLE "category" DROP CONSTRAINT "category_not_own_parent_ck";--> statement-breakpoint
ALTER TABLE "category" DROP CONSTRAINT "category_parent_fk";
--> statement-breakpoint
DROP INDEX "category_merchant_parent_idx";--> statement-breakpoint
ALTER TABLE "category" DROP COLUMN "parent_id";