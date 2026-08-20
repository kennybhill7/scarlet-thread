CREATE TYPE "public"."teaching_section_kind" AS ENUM('outline', 'context', 'connection', 'theology', 'illustration', 'objection', 'application', 'not_justified', 'discussion', 'prayer');--> statement-breakpoint
CREATE TYPE "public"."workspace_kind" AS ENUM('personal');--> statement-breakpoint
CREATE TABLE "artifact_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teaching_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"kind" "teaching_section_kind" NOT NULL,
	"sort_order" integer NOT NULL,
	"body" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "workspace_kind" NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD COLUMN "connection_id" text;--> statement-breakpoint
CREATE INDEX "artifact_revisions_workspace_idx" ON "artifact_revisions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "artifact_revisions_entity_idx" ON "artifact_revisions" USING btree ("workspace_id","entity_table","entity_id");--> statement-breakpoint
CREATE INDEX "teaching_sections_workspace_idx" ON "teaching_sections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "teaching_sections_draft_idx" ON "teaching_sections" USING btree ("workspace_id","draft_id");--> statement-breakpoint
CREATE INDEX "workspaces_created_by_idx" ON "workspaces" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "claim_evidence_connection_idx" ON "claim_evidence" USING btree ("workspace_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teaching_drafts_id_workspace_idx" ON "teaching_drafts" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_connections_id_workspace_idx" ON "user_connections" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_sections" ADD CONSTRAINT "teaching_sections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_sections" ADD CONSTRAINT "teaching_sections_draft_workspace_fk" FOREIGN KEY ("draft_id","workspace_id") REFERENCES "public"."teaching_drafts"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_connection_workspace_fk" FOREIGN KEY ("connection_id","workspace_id") REFERENCES "public"."user_connections"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motif_candidates" ADD CONSTRAINT "motif_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motif_sightings" ADD CONSTRAINT "motif_sightings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_claims" ADD CONSTRAINT "study_claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_drafts" ADD CONSTRAINT "teaching_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connections" ADD CONSTRAINT "user_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- SCHEMAFU-001, gap (b): BUILD_PLAN.md §3.2's second enforced constraint —
-- "devotional-labeled evidence can never back a theology claim" — was
-- cross-table (user_connections x claim_evidence x study_claims) and had no
-- join path until claim_evidence.connection_id (added above in this same
-- migration) named which user_connections row a "connection"-typed evidence
-- row cites. This block is hand-written, not drizzle-kit generated (drizzle
-- has no schema-level representation for triggers), and follows migration
-- 0003's deferrable-constraint-trigger pattern exactly: a shared "assert_"
-- function raising 23514 (check_violation) on violation, called from a
-- DEFERRABLE INITIALLY DEFERRED constraint trigger so a single transaction
-- may freely reorder writes (e.g. insert the evidence row before relabeling
-- the connection to 'devotional' in the same transaction) as long as the
-- invariant holds by commit.
--
-- Three entry points mirror 0003's own two-directional coverage:
--  1. claim_evidence insert/update — the row being cited changes.
--  2. user_connections.evidence_label update — a connection already cited
--     as evidence is relabeled to 'devotional' out from under a claim.
--  3. study_claims.kind update — a claim already citing devotional evidence
--     is retyped to 'theology' out from under the evidence.
-- Without (2) and (3), the rule would only be checked at the moment evidence
-- is attached, not when either side is edited afterward — the same class of
-- gap 0003's own thread-retirement and entry-restore triggers exist to close
-- for the entry/thread invariant.

CREATE FUNCTION assert_claim_evidence_not_devotional_theology(
  target_workspace_id text,
  target_claim_evidence_id text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim_kind text;
  v_evidence_label text;
BEGIN
  -- Lock the two joined rows in a stable order so a concurrent relabel/retype
  -- of either side serializes against this check rather than racing it.
  SELECT sc.kind, uc.evidence_label
  INTO v_claim_kind, v_evidence_label
  FROM claim_evidence AS ce
  INNER JOIN study_claims AS sc
    ON sc.id = ce.claim_id
   AND sc.workspace_id = ce.workspace_id
  INNER JOIN user_connections AS uc
    ON uc.id = ce.connection_id
   AND uc.workspace_id = ce.workspace_id
  WHERE ce.id = target_claim_evidence_id
    AND ce.workspace_id = target_workspace_id
  ORDER BY sc.id, uc.id
  FOR SHARE OF sc, uc;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_claim_kind = 'theology' AND v_evidence_label = 'devotional' THEN
    RAISE EXCEPTION 'A devotional-labeled connection cannot be cited as evidence for a theology claim'
      USING ERRCODE = '23514';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION check_claim_evidence_row_devotional_theology_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.evidence_type = 'connection' AND NEW.connection_id IS NOT NULL THEN
    PERFORM assert_claim_evidence_not_devotional_theology(NEW.workspace_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER claim_evidence_no_devotional_theology
AFTER INSERT OR UPDATE OF claim_id, connection_id, evidence_type, workspace_id
ON claim_evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_claim_evidence_row_devotional_theology_invariant();
--> statement-breakpoint

CREATE FUNCTION check_user_connections_evidence_label_change_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.evidence_label = 'devotional' AND (OLD.evidence_label IS DISTINCT FROM NEW.evidence_label) THEN
    FOR r IN
      SELECT ce.id
      FROM claim_evidence AS ce
      WHERE ce.connection_id = NEW.id
        AND ce.workspace_id = NEW.workspace_id
        AND ce.evidence_type = 'connection'
      FOR SHARE OF ce
    LOOP
      PERFORM assert_claim_evidence_not_devotional_theology(NEW.workspace_id, r.id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER user_connections_evidence_label_change_preserves_devotional_rule
AFTER UPDATE OF evidence_label
ON user_connections
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_user_connections_evidence_label_change_invariant();
--> statement-breakpoint

CREATE FUNCTION check_study_claims_kind_change_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.kind = 'theology' AND (OLD.kind IS DISTINCT FROM NEW.kind) THEN
    FOR r IN
      SELECT ce.id
      FROM claim_evidence AS ce
      WHERE ce.claim_id = NEW.id
        AND ce.workspace_id = NEW.workspace_id
        AND ce.evidence_type = 'connection'
      FOR SHARE OF ce
    LOOP
      PERFORM assert_claim_evidence_not_devotional_theology(NEW.workspace_id, r.id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER study_claims_kind_change_preserves_devotional_rule
AFTER UPDATE OF kind
ON study_claims
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_study_claims_kind_change_invariant();