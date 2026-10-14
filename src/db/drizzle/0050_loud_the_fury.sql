ALTER TYPE "public"."notification_kind" ADD VALUE 'venue_block_changed';--> statement-breakpoint
ALTER TABLE "venue_occupancy" DROP CONSTRAINT "venue_occupancy_ends_after_starts";--> statement-breakpoint
ALTER TABLE "venue_unavailability" DROP CONSTRAINT "venue_unavailability_ends_after_starts";--> statement-breakpoint
DROP INDEX "venue_unavailability_period_idx";--> statement-breakpoint
ALTER TABLE "venue_occupancy" ALTER COLUMN "ends_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_unavailability" ALTER COLUMN "ends_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_unavailability" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "venue_unavailability" ADD COLUMN "lifted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "venue_unavailability" ADD COLUMN "lifted_by_id" text;--> statement-breakpoint
ALTER TABLE "venue_unavailability" ADD CONSTRAINT "venue_unavailability_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_unavailability" ADD CONSTRAINT "venue_unavailability_lifted_by_id_user_id_fk" FOREIGN KEY ("lifted_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_unavailability_period_idx" ON "venue_unavailability" USING btree ("venue_id","starts_at","ends_at") WHERE "venue_unavailability"."lifted_at" is null;--> statement-breakpoint
ALTER TABLE "venue_occupancy" ADD CONSTRAINT "venue_occupancy_unbounded_only_for_block" CHECK ("venue_occupancy"."ends_at" is not null or "venue_occupancy"."venue_unavailability_id" is not null);--> statement-breakpoint
ALTER TABLE "venue_occupancy" ADD CONSTRAINT "venue_occupancy_ends_after_starts" CHECK ("venue_occupancy"."ends_at" is null or "venue_occupancy"."ends_at" > "venue_occupancy"."starts_at");--> statement-breakpoint
ALTER TABLE "venue_unavailability" ADD CONSTRAINT "venue_unavailability_ends_after_starts" CHECK ("venue_unavailability"."ends_at" is null or "venue_unavailability"."ends_at" > "venue_unavailability"."starts_at");