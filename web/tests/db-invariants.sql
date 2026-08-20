\set ON_ERROR_STOP on

-- Run against a disposable database after applying db/migrations/*.sql.
-- Every fixture is rolled back at the end.
BEGIN;

INSERT INTO users (id, email)
VALUES ('audit-u1', 'audit-u1@example.test'),
       ('audit-u2', 'audit-u2@example.test');

INSERT INTO sync_receipts (
  user_id,
  op_id,
  entity,
  entity_id,
  client_updated_at
) VALUES
  ('audit-u1', 'same-op-id', 'entry', 'one', now()),
  ('audit-u2', 'same-op-id', 'entry', 'two', now());

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM sync_receipts
    WHERE op_id = 'same-op-id'
  ) <> 2 THEN
    RAISE EXCEPTION 'Sync receipts are not tenant-scoped';
  END IF;
END;
$$;

INSERT INTO threads (user_id, slug, title)
VALUES ('audit-u1', 'one', 'One'),
       ('audit-u1', 'two', 'Two'),
       ('audit-u1', 'retired', 'Retired'),
       ('audit-u2', 'other', 'Other');

UPDATE threads
SET deleted_at = now()
WHERE user_id = 'audit-u1' AND slug = 'retired';

DO $$
BEGIN
  BEGIN
    INSERT INTO entries (id, user_id, kind, body, chapter)
    VALUES ('audit-orphan', 'audit-u1', 'observation', 'No link', '1.1');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected active orphan rejection';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END;
$$;

INSERT INTO entries (id, user_id, kind, body, chapter)
VALUES ('audit-e1', 'audit-u1', 'observation', 'Linked', '1.1');
INSERT INTO entry_threads (entry_id, user_id, thread_slug)
VALUES ('audit-e1', 'audit-u1', 'one');

DO $$
BEGIN
  BEGIN
    INSERT INTO entry_threads (entry_id, user_id, thread_slug)
    VALUES ('audit-e1', 'audit-u2', 'other');
    RAISE EXCEPTION 'Expected cross-tenant backlink rejection';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO entry_threads (entry_id, user_id, thread_slug)
    VALUES ('audit-e1', 'audit-u1', 'retired');
    RAISE EXCEPTION 'Expected retired-thread backlink rejection';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE threads
    SET deleted_at = now()
    WHERE user_id = 'audit-u1' AND slug = 'one';
    RAISE EXCEPTION 'Expected linked-thread retirement rejection';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    DELETE FROM entry_threads
    WHERE entry_id = 'audit-e1'
      AND user_id = 'audit-u1'
      AND thread_slug = 'one';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected final-backlink removal rejection';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END;
$$;

DELETE FROM entry_threads
WHERE entry_id = 'audit-e1'
  AND user_id = 'audit-u1'
  AND thread_slug = 'one';
INSERT INTO entry_threads (entry_id, user_id, thread_slug)
VALUES ('audit-e1', 'audit-u1', 'two');

UPDATE threads
SET deleted_at = now()
WHERE user_id = 'audit-u1' AND slug = 'one';

UPDATE entries
SET deleted_at = now(), updated_at = now()
WHERE id = 'audit-e1' AND user_id = 'audit-u1';
UPDATE threads
SET deleted_at = now(), updated_at = now()
WHERE user_id = 'audit-u1' AND slug = 'two';

DO $$
BEGIN
  BEGIN
    UPDATE entries
    SET deleted_at = NULL, updated_at = now()
    WHERE id = 'audit-e1' AND user_id = 'audit-u1';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected retired-target restore rejection';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END;
$$;

INSERT INTO threads (user_id, slug, title)
VALUES ('audit-u1', 'restore-target', 'Restore target');

DO $$
BEGIN
  BEGIN
    INSERT INTO entry_threads (entry_id, user_id, thread_slug)
    VALUES ('audit-e1', 'audit-u1', 'restore-target');
    RAISE EXCEPTION 'Expected deleted-entry backlink rejection';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

UPDATE entries
SET deleted_at = NULL, updated_at = now()
WHERE id = 'audit-e1' AND user_id = 'audit-u1';
DELETE FROM entry_threads
WHERE entry_id = 'audit-e1'
  AND user_id = 'audit-u1'
  AND thread_slug = 'two';
INSERT INTO entry_threads (entry_id, user_id, thread_slug)
VALUES ('audit-e1', 'audit-u1', 'restore-target');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM entries AS e
    WHERE e.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM entry_threads AS et
        INNER JOIN threads AS t
          ON t.user_id = et.user_id
         AND t.slug = et.thread_slug
         AND t.deleted_at IS NULL
        WHERE et.entry_id = e.id
          AND et.user_id = e.user_id
      )
  ) THEN
    RAISE EXCEPTION 'Active orphan survived invariant checks';
  END IF;
END;
$$;

-- TRIGGER-001: prove migration 0007's three devotional/theology constraint
-- triggers against the real engine, not just SQL text + a JS truth table
-- (schema-followups.test.ts). Same disposable-transaction, same
-- DO-block-with-caught-exception idiom as the entries/threads fixtures above.

INSERT INTO workspaces (id, kind, name, created_by)
VALUES ('audit-ws-trig', 'personal', 'Trigger fixtures', 'audit-u1');

INSERT INTO study_sessions (id, workspace_id, range, mode, workflow_state, connection_state, current_step)
VALUES ('audit-sess-trig', 'audit-ws-trig', '{"book":"Romans","chapter":1}'::jsonb, 'encounter', 'active', 'unexamined', 'read');

INSERT INTO study_claims (id, workspace_id, session_id, kind, epistemic_basis, body, passage, confidence, provenance, status)
VALUES
  ('audit-claim-theo', 'audit-ws-trig', 'audit-sess-trig', 'theology', 'text_explicit', 'Theology claim', '{"book":"Romans","chapter":1}'::jsonb, 'tentative', 'learner', 'draft'),
  ('audit-claim-obs', 'audit-ws-trig', 'audit-sess-trig', 'observation', 'text_explicit', 'Observation claim', '{"book":"Romans","chapter":1}'::jsonb, 'tentative', 'learner', 'draft');

INSERT INTO user_connections (id, workspace_id, from_range, to_range, type, evidence_label, rationale, status)
VALUES
  ('audit-conn-devo', 'audit-ws-trig', '{"book":"Romans","chapter":1}'::jsonb, '{"book":"Romans","chapter":2}'::jsonb, 'quotation', 'devotional', 'rationale text at least twenty chars', 'draft'),
  ('audit-conn-expl', 'audit-ws-trig', '{"book":"Romans","chapter":1}'::jsonb, '{"book":"Romans","chapter":3}'::jsonb, 'quotation', 'explicit', 'rationale text at least twenty chars', 'draft');

-- citing a devotional connection as evidence for a theology claim is rejected
DO $$
BEGIN
  BEGIN
    INSERT INTO claim_evidence (id, workspace_id, claim_id, evidence_type, connection_id, note)
    VALUES ('audit-ce-1a', 'audit-ws-trig', 'audit-claim-theo', 'connection', 'audit-conn-devo', 'cites devotional for theology');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected devotional-evidence-for-theology rejection (insert path)';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END;
$$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM claim_evidence WHERE id = 'audit-ce-1a') THEN
    RAISE EXCEPTION 'Rejected claim_evidence row should not exist';
  END IF;
END;
$$;

-- allowed case: a devotional connection CAN back a NON-theology claim
INSERT INTO claim_evidence (id, workspace_id, claim_id, evidence_type, connection_id, note)
VALUES ('audit-ce-2a', 'audit-ws-trig', 'audit-claim-obs', 'connection', 'audit-conn-devo', 'devotional evidence for observation claim');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- retyping a claim that already cites devotional evidence to theology is rejected
DO $$
BEGIN
  BEGIN
    UPDATE study_claims SET kind = 'theology' WHERE id = 'audit-claim-obs' AND workspace_id = 'audit-ws-trig';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected claim-retype-to-theology rejection';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END;
$$;
DO $$
BEGIN
  IF (SELECT kind FROM study_claims WHERE id = 'audit-claim-obs') <> 'observation' THEN
    RAISE EXCEPTION 'Rejected claim retype should not have landed';
  END IF;
END;
$$;

-- allowed case: a non-devotional connection CAN back a theology claim
INSERT INTO claim_evidence (id, workspace_id, claim_id, evidence_type, connection_id, note)
VALUES ('audit-ce-2b', 'audit-ws-trig', 'audit-claim-theo', 'connection', 'audit-conn-expl', 'explicit evidence for theology claim');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- relabeling an already-cited connection to devotional under a theology claim is rejected
DO $$
BEGIN
  BEGIN
    UPDATE user_connections SET evidence_label = 'devotional' WHERE id = 'audit-conn-expl' AND workspace_id = 'audit-ws-trig';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected relabel-to-devotional-under-theology-claim rejection';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END;
$$;
DO $$
BEGIN
  IF (SELECT evidence_label FROM user_connections WHERE id = 'audit-conn-expl') <> 'explicit' THEN
    RAISE EXCEPTION 'Rejected relabel should not have landed';
  END IF;
END;
$$;

-- DEFERRABLE behaviour: a transaction may pass through a state that violates
-- the invariant, as long as it is resolved before the constraint is checked
-- (real COMMIT, or an explicit SET CONSTRAINTS ALL IMMEDIATE). audit-ce-2b
-- currently cites audit-conn-expl (explicit) for the theology claim --
-- allowed. Relabeling audit-conn-expl to devotional would violate the
-- invariant if checked now, but the trigger is deferred so the statement
-- itself succeeds.
UPDATE user_connections SET evidence_label = 'devotional' WHERE id = 'audit-conn-expl' AND workspace_id = 'audit-ws-trig';

-- prove the violation is real at this point in the transaction (would fail if forced now)
DO $$
BEGIN
  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected the mid-transaction state to be rejected when forced immediate';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END;
$$;

-- heal it before commit: relabel the connection off 'devotional' again (to a
-- different label than its original, proving this is a real update, not a
-- no-op that never actually violated anything)
UPDATE user_connections SET evidence_label = 'strong' WHERE id = 'audit-conn-expl' AND workspace_id = 'audit-ws-trig';

-- forcing the check now (standing in for a real COMMIT) must succeed
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

ROLLBACK;
