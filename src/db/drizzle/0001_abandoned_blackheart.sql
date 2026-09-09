DROP TABLE "passkey" CASCADE;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'attendee' NOT NULL;