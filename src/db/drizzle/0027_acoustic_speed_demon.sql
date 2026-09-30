CREATE TABLE "equipment_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"equipment_request_id" text NOT NULL,
	"equipment_type_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_reservations_quantity_positive" CHECK ("equipment_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "equipment_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quantity_held" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_types_name_unique" UNIQUE("name"),
	CONSTRAINT "equipment_types_quantity_held_positive" CHECK ("equipment_types"."quantity_held" > 0)
);
--> statement-breakpoint
CREATE TABLE "equipment_unavailability" (
	"id" serial PRIMARY KEY NOT NULL,
	"equipment_type_id" integer NOT NULL,
	"quantity_unavailable" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_unavailability_quantity_positive" CHECK ("equipment_unavailability"."quantity_unavailable" > 0)
);
--> statement-breakpoint
ALTER TABLE "equipment_reservations" ADD CONSTRAINT "equipment_reservations_equipment_request_id_equipment_requests_id_fk" FOREIGN KEY ("equipment_request_id") REFERENCES "public"."equipment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_reservations" ADD CONSTRAINT "equipment_reservations_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_unavailability" ADD CONSTRAINT "equipment_unavailability_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_reservations_equipment_type_id_idx" ON "equipment_reservations" USING btree ("equipment_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_unavailability_type_reason_idx" ON "equipment_unavailability" USING btree ("equipment_type_id","reason");