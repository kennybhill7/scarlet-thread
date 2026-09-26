ALTER TABLE "graph_edges" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD COLUMN "viewpoint_id" text;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD COLUMN "release_id" text;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD COLUMN "review_status" text DEFAULT 'imported' NOT NULL;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_review_status_check" CHECK ("graph_edges"."review_status" IN ('imported', 'reviewed'));