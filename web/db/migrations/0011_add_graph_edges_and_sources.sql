CREATE TABLE "graph_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"from_range" jsonb NOT NULL,
	"to_range" jsonb NOT NULL,
	"type" "connection_type" NOT NULL,
	"evidence_label" "evidence_label" NOT NULL,
	"source_id" text NOT NULL,
	"community_votes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"author" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text NOT NULL,
	"url" text NOT NULL,
	"licence" text NOT NULL,
	"accessed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_edges_from_to_type_idx" ON "graph_edges" USING btree ("from_range","to_range","type");--> statement-breakpoint
CREATE INDEX "graph_edges_source_idx" ON "graph_edges" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_url_idx" ON "sources" USING btree ("url");