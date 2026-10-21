ALTER TABLE "appointments" ADD COLUMN "cancel_token" text;--> statement-breakpoint
UPDATE "appointments" SET "cancel_token" = gen_random_uuid()::text WHERE "cancel_token" IS NULL;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "cancel_token" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "barbers" ADD COLUMN "photo_url" text;
