DROP INDEX "equipment_reservations_equipment_type_id_idx";--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "equipment_type_id" integer;--> statement-breakpoint
ALTER TABLE "equipment_reservations" ADD COLUMN "starts_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_reservations" ADD COLUMN "ends_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_reservations_equipment_request_id_idx" ON "equipment_reservations" USING btree ("equipment_request_id");--> statement-breakpoint
CREATE INDEX "equipment_reservations_type_period_idx" ON "equipment_reservations" USING btree ("equipment_type_id","starts_at","ends_at");--> statement-breakpoint
ALTER TABLE "equipment_reservations" ADD CONSTRAINT "equipment_reservations_ends_after_starts" CHECK ("equipment_reservations"."ends_at" > "equipment_reservations"."starts_at");