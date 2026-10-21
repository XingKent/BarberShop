CREATE TYPE "public"."code_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_phone_unique";--> statement-breakpoint
ALTER TABLE "login_codes" ADD COLUMN "purpose" "code_purpose" DEFAULT 'verify_email' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
-- Contas que já existiam entraram por código no e-mail (ou são o dono): contam como confirmadas.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
