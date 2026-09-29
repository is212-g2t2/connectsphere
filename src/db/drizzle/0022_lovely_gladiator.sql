ALTER TABLE "equipment_requests" ADD COLUMN "quantity" integer DEFAULT 1;
UPDATE "equipment_requests" SET "quantity" = 1 WHERE "quantity" IS NULL;
ALTER TABLE "equipment_requests" ALTER COLUMN "quantity" SET NOT NULL;
ALTER TABLE "equipment_requests" ALTER COLUMN "quantity" DROP DEFAULT;
ALTER TABLE "event_requests" ADD COLUMN "equipment_submitted_at" timestamp with time zone;
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_quantity_positive" CHECK ("equipment_requests"."quantity" > 0);