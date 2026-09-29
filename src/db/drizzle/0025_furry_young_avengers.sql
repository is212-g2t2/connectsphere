ALTER TABLE "equipment_requests" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN "equipment_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_quantity_positive" CHECK ("equipment_requests"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "equipment_requests" ALTER COLUMN "quantity" DROP DEFAULT;