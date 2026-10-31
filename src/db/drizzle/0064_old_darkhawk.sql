CREATE TABLE "room_layouts" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_layouts_label_unique" UNIQUE("label")
);
