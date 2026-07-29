-- Enforce the passage/thread invariant under concurrent requests. Application
-- validation gives friendly errors; these triggers are the fail-closed layer.

CREATE FUNCTION assert_active_entry_has_thread(
  target_user_id text,
  target_entry_id text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Lock final targets in a stable order. This serializes an entry restore
  -- against a concurrent thread retirement while still allowing the same
  -- transaction to replace old links before this deferred check runs.
  PERFORM t.slug
  FROM entry_threads AS et
  INNER JOIN threads AS t
    ON t.user_id = et.user_id
   AND t.slug = et.thread_slug
  WHERE et.entry_id = target_entry_id
    AND et.user_id = target_user_id
  ORDER BY t.user_id, t.slug
  FOR SHARE OF t;

  IF EXISTS (
    SELECT 1
    FROM entries
    WHERE id = target_entry_id
      AND user_id = target_user_id
      AND deleted_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1
    FROM entry_threads AS et
    INNER JOIN threads AS t
      ON t.user_id = et.user_id
     AND t.slug = et.thread_slug
     AND t.deleted_at IS NULL
    WHERE et.entry_id = target_entry_id
      AND et.user_id = target_user_id
  ) THEN
    RAISE EXCEPTION 'Active entry must link at least one active thread'
      USING ERRCODE = '23514';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION validate_entry_thread_target()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- These row locks conflict with concurrent soft-delete updates. A backlink
  -- may only connect two active records.
  PERFORM 1
  FROM entries
  WHERE id = NEW.entry_id
    AND user_id = NEW.user_id
    AND deleted_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry link must target an active entry'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM threads
  WHERE user_id = NEW.user_id
    AND slug = NEW.thread_slug
    AND deleted_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry link must target an active thread'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER entry_threads_active_target
BEFORE INSERT OR UPDATE OF user_id, thread_slug
ON entry_threads
FOR EACH ROW
EXECUTE FUNCTION validate_entry_thread_target();
--> statement-breakpoint

CREATE FUNCTION prevent_linked_thread_retirement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
    SELECT 1
    FROM entry_threads AS et
    INNER JOIN entries AS e
      ON e.id = et.entry_id
     AND e.user_id = et.user_id
     AND e.deleted_at IS NULL
    WHERE et.user_id = NEW.user_id
      AND et.thread_slug = NEW.slug
  ) THEN
    RAISE EXCEPTION 'Thread is still linked to active writing'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER threads_no_active_link_retirement
BEFORE UPDATE OF deleted_at
ON threads
FOR EACH ROW
EXECUTE FUNCTION prevent_linked_thread_retirement();
--> statement-breakpoint

CREATE FUNCTION check_entry_row_thread_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM assert_active_entry_has_thread(NEW.user_id, NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER entries_require_thread
AFTER INSERT OR UPDATE
ON entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_entry_row_thread_invariant();
--> statement-breakpoint

CREATE FUNCTION check_link_change_entry_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM assert_active_entry_has_thread(OLD.user_id, OLD.entry_id);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM assert_active_entry_has_thread(NEW.user_id, NEW.entry_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER entry_thread_changes_preserve_entry_link
AFTER INSERT OR UPDATE OR DELETE
ON entry_threads
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_link_change_entry_invariant();
