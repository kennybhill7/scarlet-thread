CREATE TYPE "public"."claim_confidence" AS ENUM('tentative', 'developing', 'well_supported');--> statement-breakpoint
CREATE TYPE "public"."claim_evidence_type" AS ENUM('passage', 'context', 'connection', 'source');--> statement-breakpoint
CREATE TYPE "public"."claim_kind" AS ENUM('observation', 'question', 'context', 'interpretation', 'theology', 'conviction', 'application', 'teaching_seed');--> statement-breakpoint
CREATE TYPE "public"."claim_provenance" AS ENUM('learner', 'imported');--> statement-breakpoint
CREATE TYPE "public"."connection_type" AS ENUM('quotation', 'explicit_reference', 'allusion', 'motif', 'promise_fulfillment', 'type_antitype', 'covenant_development', 'contrast_reversal', 'parallel', 'doctrinal_synthesis', 'personal_resonance');--> statement-breakpoint
CREATE TYPE "public"."doctrine_status" AS ENUM('core', 'conviction', 'open', 'disputed', 'wisdom');--> statement-breakpoint
CREATE TYPE "public"."epistemic_basis" AS ENUM('text_explicit', 'historical_context', 'inference', 'canonical_synthesis', 'tradition', 'prudential_judgment', 'personal_reflection');--> statement-breakpoint
CREATE TYPE "public"."evidence_label" AS ENUM('explicit', 'strong', 'plausible', 'devotional');--> statement-breakpoint
CREATE TYPE "public"."modern_domain" AS ENUM('work', 'money', 'relationships', 'grief', 'anxiety', 'leadership', 'justice', 'technology', 'sexuality', 'church');--> statement-breakpoint
CREATE TYPE "public"."response_type" AS ENUM('belief', 'repentance', 'prayer', 'lament', 'worship', 'rest', 'relationship', 'service', 'action');--> statement-breakpoint
CREATE TYPE "public"."study_claim_status" AS ENUM('draft', 'revisited', 'confirmed', 'needs_revision');--> statement-breakpoint
CREATE TYPE "public"."study_session_connection_state" AS ENUM('unexamined', 'provisional', 'linked', 'no_warrant_yet');--> statement-breakpoint
CREATE TYPE "public"."study_session_mode" AS ENUM('encounter', 'deep', 'guided');--> statement-breakpoint
CREATE TYPE "public"."study_session_workflow_state" AS ENUM('active', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."user_connection_status" AS ENUM('draft', 'confirmed', 'revisit');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"source_claim_id" text NOT NULL,
	"original_audience_meaning" text NOT NULL,
	"enduring_principle" text NOT NULL,
	"canonical_bridge" text NOT NULL,
	"application_class" text NOT NULL,
	"promise_scope" text NOT NULL,
	"modern_domain" "modern_domain" NOT NULL,
	"situation" text NOT NULL,
	"response_type" "response_type" NOT NULL,
	"faithful_response" text NOT NULL,
	"cautions" text NOT NULL,
	"available_after" timestamp with time zone,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"evidence_type" "claim_evidence_type" NOT NULL,
	"canonical_reference" jsonb,
	"display_reference" jsonb,
	"content_block_id" text,
	"citation_id" text,
	"note" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "motif_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"label" text NOT NULL,
	"normalized_key" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "motif_sightings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"passage_unit_key" text NOT NULL,
	"exact_range" jsonb NOT NULL,
	"entry_id" text,
	"claim_id" text,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "study_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"kind" "claim_kind" NOT NULL,
	"epistemic_basis" "epistemic_basis" NOT NULL,
	"body" text NOT NULL,
	"passage" jsonb NOT NULL,
	"confidence" "claim_confidence" NOT NULL,
	"provenance" "claim_provenance" NOT NULL,
	"doctrine_status" "doctrine_status",
	"viewpoint_id" text,
	"status" "study_claim_status" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"range" jsonb NOT NULL,
	"mode" "study_session_mode" NOT NULL,
	"workflow_state" "study_session_workflow_state" NOT NULL,
	"connection_state" "study_session_connection_state" NOT NULL,
	"catalog_release_id" text,
	"read_gate_at" timestamp with time zone,
	"current_step" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teaching_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"title" text NOT NULL,
	"big_idea" text NOT NULL,
	"audience" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"gospel_connection" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"from_range" jsonb NOT NULL,
	"to_range" jsonb NOT NULL,
	"type" "connection_type" NOT NULL,
	"evidence_label" "evidence_label" NOT NULL,
	"rationale" text NOT NULL,
	"thread_slug" text,
	"status" "user_connection_status" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_connections_personal_resonance_devotional_check" CHECK ("user_connections"."type" <> 'personal_resonance' OR "user_connections"."evidence_label" = 'devotional')
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_session_workspace_fk" FOREIGN KEY ("session_id","workspace_id") REFERENCES "public"."study_sessions"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_source_claim_workspace_fk" FOREIGN KEY ("source_claim_id","workspace_id") REFERENCES "public"."study_claims"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_workspace_fk" FOREIGN KEY ("claim_id","workspace_id") REFERENCES "public"."study_claims"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motif_sightings" ADD CONSTRAINT "motif_sightings_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motif_sightings" ADD CONSTRAINT "motif_sightings_candidate_workspace_fk" FOREIGN KEY ("candidate_id","workspace_id") REFERENCES "public"."motif_candidates"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motif_sightings" ADD CONSTRAINT "motif_sightings_claim_workspace_fk" FOREIGN KEY ("claim_id","workspace_id") REFERENCES "public"."study_claims"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_claims" ADD CONSTRAINT "study_claims_session_workspace_fk" FOREIGN KEY ("session_id","workspace_id") REFERENCES "public"."study_sessions"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_drafts" ADD CONSTRAINT "teaching_drafts_session_workspace_fk" FOREIGN KEY ("session_id","workspace_id") REFERENCES "public"."study_sessions"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_workspace_idx" ON "applications" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_workspace_idx" ON "claim_evidence" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_claim_idx" ON "claim_evidence" USING btree ("workspace_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "motif_candidates_id_workspace_idx" ON "motif_candidates" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "motif_candidates_workspace_idx" ON "motif_candidates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "motif_candidates_workspace_key_idx" ON "motif_candidates" USING btree ("workspace_id","normalized_key");--> statement-breakpoint
CREATE INDEX "motif_sightings_workspace_idx" ON "motif_sightings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "motif_sightings_candidate_idx" ON "motif_sightings" USING btree ("workspace_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_claims_id_workspace_idx" ON "study_claims" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "study_claims_workspace_idx" ON "study_claims" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "study_claims_workspace_passage_idx" ON "study_claims" USING btree ("workspace_id","passage");--> statement-breakpoint
CREATE INDEX "study_claims_workspace_kind_idx" ON "study_claims" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "study_sessions_id_workspace_idx" ON "study_sessions" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "study_sessions_workspace_idx" ON "study_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "teaching_drafts_workspace_idx" ON "teaching_drafts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_connections_workspace_range_type_idx" ON "user_connections" USING btree ("workspace_id","from_range","to_range","type");--> statement-breakpoint
CREATE INDEX "user_connections_workspace_idx" ON "user_connections" USING btree ("workspace_id");