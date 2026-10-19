CREATE TYPE "public"."safety_review_state" AS ENUM('pending', 'approved', 'rejected', 'changes_requested');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'safety_review_decided';--> statement-breakpoint
CREATE TABLE "safety_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_request_id" integer NOT NULL,
	"state" "safety_review_state" DEFAULT 'pending' NOT NULL,
	"fingerprint" text NOT NULL,
	"comments" text,
	"decided_by_id" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "safety_reviews_fingerprint_present" CHECK (btrim("safety_reviews"."fingerprint") <> ''),
	CONSTRAINT "safety_reviews_decision_complete" CHECK (("safety_reviews"."state"::text = 'pending' and "safety_reviews"."decided_by_id" is null and "safety_reviews"."decided_by_name" is null and "safety_reviews"."decided_at" is null and "safety_reviews"."comments" is null) or ("safety_reviews"."state"::text <> 'pending' and "safety_reviews"."decided_by_id" is not null and btrim("safety_reviews"."decided_by_id") <> '' and "safety_reviews"."decided_by_name" is not null and btrim("safety_reviews"."decided_by_name") <> '' and "safety_reviews"."decided_at" is not null)),
	CONSTRAINT "safety_reviews_comments_match_state" CHECK (("safety_reviews"."state"::text = 'pending' and "safety_reviews"."comments" is null) or ("safety_reviews"."state"::text = 'approved' and ("safety_reviews"."comments" is null or "safety_reviews"."comments" ~ '[^[:space:]]')) or ("safety_reviews"."state"::text in ('rejected', 'changes_requested') and coalesce("safety_reviews"."comments", '') ~ '[^[:space:]]'))
);
--> statement-breakpoint
ALTER TABLE "safety_reviews" ADD CONSTRAINT "safety_reviews_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_reviews_pending_event_idx" ON "safety_reviews" USING btree ("event_request_id") WHERE "safety_reviews"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "safety_reviews_event_request_id_idx" ON "safety_reviews" USING btree ("event_request_id");