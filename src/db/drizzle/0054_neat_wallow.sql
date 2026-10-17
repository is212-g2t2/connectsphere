ALTER TABLE "venue_holds" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD COLUMN "warn_at" timestamp;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD COLUMN "expiry_changed_by_id" text;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD COLUMN "expiry_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_expiry_changed_by_id_user_id_fk" FOREIGN KEY ("expiry_changed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_holds_expiry_changed_by_id_idx" ON "venue_holds" USING btree ("expiry_changed_by_id");--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_warn_before_expiry" CHECK ("venue_holds"."warn_at" is null or "venue_holds"."expires_at" is null or "venue_holds"."warn_at" < "venue_holds"."expires_at");