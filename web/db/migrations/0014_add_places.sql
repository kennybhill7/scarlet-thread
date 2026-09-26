CREATE TYPE "public"."place_kind" AS ENUM('point', 'region', 'route', 'water', 'unlocated');--> statement-breakpoint
CREATE TYPE "public"."place_tier" AS ENUM('identified', 'likely', 'uncertain', 'disputed', 'unlocated');--> statement-breakpoint
CREATE TABLE "place_candidates" (
	"place_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"description" text NOT NULL,
	"lon" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"score" integer NOT NULL,
	CONSTRAINT "place_candidates_place_id_ordinal_pk" PRIMARY KEY("place_id","ordinal"),
	CONSTRAINT "place_candidates_coords_range_check" CHECK ("place_candidates"."lon" BETWEEN -180 AND 180 AND "place_candidates"."lat" BETWEEN -90 AND 90)
);
--> statement-breakpoint
CREATE TABLE "place_passages" (
	"place_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"range" jsonb NOT NULL,
	"in_dataset_verse_list" boolean NOT NULL,
	"note" text,
	CONSTRAINT "place_passages_place_id_ordinal_pk" PRIMARY KEY("place_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ancient_id" text NOT NULL,
	"kind" "place_kind" NOT NULL,
	"tier" "place_tier" NOT NULL,
	"lon" double precision,
	"lat" double precision,
	"coordinate_basis" text,
	"modern_name" text,
	"note" text,
	"source_id" text NOT NULL,
	"dataset_score" integer NOT NULL,
	"vote_count" integer NOT NULL,
	"identifications_in_dataset" integer NOT NULL,
	"release_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_unlocated_no_coords_check" CHECK ("places"."tier" <> 'unlocated' OR ("places"."lon" IS NULL AND "places"."lat" IS NULL)),
	CONSTRAINT "places_located_has_coords_check" CHECK ("places"."tier" = 'unlocated' OR ("places"."lon" IS NOT NULL AND "places"."lat" IS NOT NULL)),
	CONSTRAINT "places_coords_paired_check" CHECK (("places"."lon" IS NULL) = ("places"."lat" IS NULL)),
	CONSTRAINT "places_coords_range_check" CHECK (("places"."lon" IS NULL OR "places"."lon" BETWEEN -180 AND 180) AND ("places"."lat" IS NULL OR "places"."lat" BETWEEN -90 AND 90)),
	CONSTRAINT "places_kind_unlocated_iff_tier_check" CHECK (("places"."kind" = 'unlocated') = ("places"."tier" = 'unlocated'))
);
--> statement-breakpoint
ALTER TABLE "place_candidates" ADD CONSTRAINT "place_candidates_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_passages" ADD CONSTRAINT "place_passages_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_release_id_catalog_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."catalog_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "place_passages_place_range_idx" ON "place_passages" USING btree ("place_id","range");--> statement-breakpoint
CREATE INDEX "places_source_idx" ON "places" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "places_ancient_id_idx" ON "places" USING btree ("ancient_id");