CREATE TABLE "catalog_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checksum" text NOT NULL,
	"lesson_count" integer NOT NULL,
	"bundle" jsonb NOT NULL
);
