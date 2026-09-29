ALTER TABLE "equipment_requests" ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_requests" ALTER COLUMN "quantity" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN IF NOT EXISTS "equipment_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "equipment_requests" DROP CONSTRAINT IF EXISTS "equipment_requests_quantity_positive";--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_quantity_positive" CHECK ("equipment_requests"."quantity" > 0);