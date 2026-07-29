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

ROLLBACK;
