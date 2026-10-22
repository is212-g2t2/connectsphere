CREATE TABLE "event_request_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_request_id" integer NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_request_attachments_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "event_request_attachments_size_positive" CHECK ("event_request_attachments"."size_bytes" > 0),
	CONSTRAINT "event_request_attachments_size_limit" CHECK ("event_request_attachments"."size_bytes" <= 10485760)
);
--> statement-breakpoint
ALTER TABLE "event_request_attachments" ADD CONSTRAINT "event_request_attachments_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_request_attachments" ADD CONSTRAINT "event_request_attachments_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_request_attachments_event_request_id_idx" ON "event_request_attachments" USING btree ("event_request_id");