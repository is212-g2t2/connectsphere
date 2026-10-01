ALTER TABLE "equipment_requests" ADD COLUMN "last_released_by_staff_id" text;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "last_released_by_staff_name" text;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "last_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "last_released_quantity" integer;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_last_released_by_staff_id_user_id_fk" FOREIGN KEY ("last_released_by_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_requests_last_released_by_staff_id_idx" ON "equipment_requests" USING btree ("last_released_by_staff_id");--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_last_released_positive" CHECK ("equipment_requests"."last_released_quantity" is null or "equipment_requests"."last_released_quantity" > 0);