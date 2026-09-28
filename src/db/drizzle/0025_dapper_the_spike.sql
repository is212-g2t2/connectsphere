DROP INDEX "venue_holds_venue_id_idx";--> statement-breakpoint
CREATE INDEX "venue_holds_venue_id_starts_at_idx" ON "venue_holds" USING btree ("venue_id","starts_at");