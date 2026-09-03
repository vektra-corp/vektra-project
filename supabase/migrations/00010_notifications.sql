-- =============================================================================
-- 00010_notifications
--
-- Turns task and comment activity into per-user notifications.
--
-- These live in the database rather than in the server actions because a task
-- can be assigned from several places — the board, the detail panel, an import,
-- a workflow, an Inngest job. A trigger fires for all of them; application code
-- would have to remember at every call site.
-- =============================================================================

/*
 * Notify the assignee when a task is assigned to them.
 *
 * Self-assignment is deliberately silent: telling someone they just did
 * something they know they did is noise, and noisy notifications get muted.
 */
CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_project text;
BEGIN
  IF NEW.assignee_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN
    RETURN NULL;
  END IF;

  IF NEW.assignee_id = v_actor THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_project FROM projects WHERE id = NEW.project_id;

  INSERT INTO notifications (organization_id, user_id, type, title, body, data)
  VALUES (
    NEW.organization_id,
    NEW.assignee_id,
    'task_assigned',
    NEW.title,
    COALESCE(v_project, 'A project'),
    jsonb_build_object(
      'task_id', NEW.id,
      'project_id', NEW.project_id,
      'task_number', NEW.task_number,
      'actor_id', v_actor
    )
  );

  RETURN NULL;
END;
$$;

CREATE TRIGGER notify_task_assignment_trigger
  AFTER INSERT OR UPDATE OF assignee_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assignment();

/* Subtasks carry task_id rather than project_id, so they need their own lookup. */
CREATE OR REPLACE FUNCTION public.notify_subtask_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_task  record;
BEGIN
  IF NEW.assignee_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id)
     OR NEW.assignee_id = v_actor THEN
    RETURN NULL;
  END IF;

  SELECT t.id, t.project_id, t.title INTO v_task FROM tasks t WHERE t.id = NEW.task_id;

  INSERT INTO notifications (organization_id, user_id, type, title, body, data)
  VALUES (
    NEW.organization_id,
    NEW.assignee_id,
    'task_assigned',
    NEW.title,
    COALESCE(v_task.title, 'A task'),
    jsonb_build_object(
      'task_id', NEW.task_id,
      'subtask_id', NEW.id,
      'project_id', v_task.project_id,
      'actor_id', v_actor
    )
  );

  RETURN NULL;
END;
$$;

CREATE TRIGGER notify_subtask_assignment_trigger
  AFTER INSERT OR UPDATE OF assignee_id ON subtasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_subtask_assignment();

/*
 * Notify people watching a task when a comment lands: its assignee, its
 * creator, and everyone who has already commented — minus the author.
 *
 * Internal comments are only delivered to staff. A portal user must never
 * receive a notification about a comment they are not allowed to read.
 */
CREATE OR REPLACE FUNCTION public.notify_task_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task record;
BEGIN
  IF NEW.task_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.id, t.title, t.project_id, t.assignee_id, t.created_by
  INTO v_task
  FROM tasks t WHERE t.id = NEW.task_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO notifications (organization_id, user_id, type, title, body, data)
  SELECT
    NEW.organization_id,
    recipient,
    'comment_created',
    v_task.title,
    'New comment',
    jsonb_build_object(
      'task_id', v_task.id,
      'project_id', v_task.project_id,
      'comment_id', NEW.id,
      'actor_id', NEW.author_id
    )
  FROM (
    SELECT v_task.assignee_id AS recipient
    UNION
    SELECT v_task.created_by
    UNION
    SELECT c.author_id FROM comments c WHERE c.task_id = NEW.task_id
  ) AS candidates
  WHERE recipient IS NOT NULL
    AND recipient <> NEW.author_id
    -- Internal comments stay inside the organization.
    AND (
      NEW.is_internal = false
      OR EXISTS (
        SELECT 1 FROM org_members om
        WHERE om.user_id = recipient AND om.organization_id = NEW.organization_id
      )
    );

  RETURN NULL;
END;
$$;

CREATE TRIGGER notify_task_comment_trigger
  AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_comment();

-- Unread lookups are the hot path for the notification bell.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id, created_at DESC) WHERE NOT is_read;
