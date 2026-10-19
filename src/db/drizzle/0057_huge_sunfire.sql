ALTER TYPE "public"."notification_kind" ADD VALUE 'venue_hold_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'venue_hold_placed';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'venue_hold_declined';--> statement-breakpoint
ALTER TYPE "public"."venue_hold_status" ADD VALUE 'requested';--> statement-breakpoint
ALTER TYPE "public"."venue_hold_status" ADD VALUE 'declined';--> statement-breakpoint
ALTER TABLE "venue_holds" ADD COLUMN "placed_by_id" text;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD COLUMN "decline_reason" text;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD COLUMN "declined_by_id" text;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_placed_by_id_user_id_fk" FOREIGN KEY ("placed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_declined_by_id_user_id_fk" FOREIGN KEY ("declined_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_holds_placed_by_id_idx" ON "venue_holds" USING btree ("placed_by_id");--> statement-breakpoint
CREATE INDEX "venue_holds_declined_by_id_idx" ON "venue_holds" USING btree ("declined_by_id");--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_decline_reason_matches_status" CHECK (("venue_holds"."status"::text = 'declined' and coalesce("venue_holds"."decline_reason", '') ~ '[^[:space:]]') or ("venue_holds"."status"::text <> 'declined' and "venue_holds"."decline_reason" is null));