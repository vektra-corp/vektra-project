-- =============================================================================
-- 00036_comment_mentions
--
-- Two changes to how a comment turns into notifications.
--
-- 1. @mentions. The composer writes a Tiptap `mention` node carrying the
--    mentioned person's id. Everyone already watching the task gets the usual
--    'comment_created'; anyone named in the body gets 'comment_mention'
--    instead. Doing the fan-out here rather than in the server action is what
--    makes "instead" possible — one statement decides every recipient, so a
--    watcher who is also mentioned receives exactly one notification, the more
--    urgent of the two, rather than one from a trigger and another from the app.
--
-- 2. Deep links. The notification payloads carried uuids, which are no longer
--    what a URL contains (migration 00034), and never carried the workspace
--    slug the URL also needs — so the "open in app" link in every notification
--    email silently degraded to the notifications list. The payloads now carry
--    the public ids and the slug, and the link works.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Mention extraction
-- -----------------------------------------------------------------------------

/*
 * Ids named by @mention in a Tiptap document.
 *
 * `$.**` is jsonpath's recursive descent, so this finds mention nodes at any
 * depth — inside a list item, inside a blockquote — without the function having
 * to know the document's shape. Values that are not uuids are ignored rather
 * than cast: `attrs.id` is client-supplied, and a crafted body must not be able
 * to raise an exception inside a trigger and roll back the comment.
 */
CREATE OR REPLACE FUNCTION public.mentioned_user_ids(p_body jsonb)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- The cast sits inside a CASE rather than after a WHERE guard on purpose:
  -- the planner is free to evaluate a projection before a filter, so a WHERE
  -- that "already excluded" a malformed value is not a guarantee that the cast
  -- never sees one. CASE makes the guard part of the same expression.
  SELECT DISTINCT id
  FROM (
    SELECT CASE
             WHEN text_value ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             THEN text_value::uuid
           END AS id
    FROM (
      SELECT value #>> '{}' AS text_value
      FROM jsonb_path_query(
             COALESCE(p_body, '{}'::jsonb),
             '$.** ? (@.type == "mention").attrs.id'
           ) AS value
      WHERE jsonb_typeof(value) = 'string'
    ) AS raw
  ) AS parsed
  WHERE id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.mentioned_user_ids(jsonb) IS
  'User ids named by @mention anywhere in a Tiptap document. Non-uuid values are ignored, never cast.';

-- -----------------------------------------------------------------------------
-- Comment notifications: watchers and mentions in one pass
-- -----------------------------------------------------------------------------

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

  SELECT t.id, t.public_id, t.title, t.project_id, t.assignee_id, t.created_by,
         p.public_id AS project_public_id,
         w.slug      AS workspace_slug
  INTO v_task
  FROM tasks t
  JOIN projects p   ON p.id = t.project_id
  JOIN workspaces w ON w.id = p.workspace_id
  WHERE t.id = NEW.task_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO notifications (organization_id, user_id, type, title, body, data)
  SELECT
    NEW.organization_id,
    candidates.recipient,
    CASE WHEN candidates.mentioned THEN 'comment_mention' ELSE 'comment_created' END,
    v_task.title,
    CASE WHEN candidates.mentioned THEN 'Mentioned you in a comment' ELSE 'New comment' END,
    jsonb_build_object(
      'task_id', v_task.id,
      'task_public_id', v_task.public_id,
      'project_id', v_task.project_id,
      'project_public_id', v_task.project_public_id,
      'workspace_slug', v_task.workspace_slug,
      'comment_id', NEW.id,
      'actor_id', NEW.author_id
    )
  FROM (
    -- bool_or collapses the two sources to one row per person, so someone who
    -- is both the assignee and mentioned is notified once, as a mention.
    SELECT recipient, bool_or(mentioned) AS mentioned
    FROM (
      SELECT v_task.assignee_id AS recipient, false AS mentioned
      UNION ALL
      SELECT v_task.created_by, false
      UNION ALL
      SELECT c.author_id, false FROM comments c WHERE c.task_id = NEW.task_id
      UNION ALL
      SELECT m, true FROM public.mentioned_user_ids(NEW.body) AS m
    ) AS sources
    WHERE recipient IS NOT NULL
    GROUP BY recipient
  ) AS candidates
  WHERE candidates.recipient <> NEW.author_id
    -- Internal comments stay inside the organization. This covers mentions too:
    -- naming a portal user in an internal note must not tell them it exists.
    AND (
      NEW.is_internal = false
      OR EXISTS (
        SELECT 1 FROM org_members om
        WHERE om.user_id = candidates.recipient
          AND om.organization_id = NEW.organization_id
      )
    )
    -- A mention only reaches someone who can already open the task. Without
    -- this, typing a name into the composer would be a way to push a
    -- notification at anyone in the organization, project membership or not.
    AND (
      NOT candidates.mentioned
      OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = v_task.project_id
          AND pm.user_id = candidates.recipient
      )
      OR EXISTS (
        SELECT 1 FROM projects pr
        JOIN workspace_members wm ON wm.workspace_id = pr.workspace_id
        WHERE pr.id = v_task.project_id
          AND wm.user_id = candidates.recipient
      )
    );

  RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- Assignment notifications: same payload shape, so one link builder serves all
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_proj  record;
BEGIN
  IF NEW.assignee_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN
    RETURN NULL;
  END IF;

  -- Self-assignment is deliberately silent: telling someone they just did
  -- something they know they did is noise, and noisy notifications get muted.
  IF NEW.assignee_id = v_actor THEN
    RETURN NULL;
  END IF;

  SELECT p.name, p.public_id, w.slug AS workspace_slug
  INTO v_proj
  FROM projects p
  JOIN workspaces w ON w.id = p.workspace_id
  WHERE p.id = NEW.project_id;

  INSERT INTO notifications (organization_id, user_id, type, title, body, data)
  VALUES (
    NEW.organization_id,
    NEW.assignee_id,
    'task_assigned',
    NEW.title,
    COALESCE(v_proj.name, 'A project'),
    jsonb_build_object(
      'task_id', NEW.id,
      'task_public_id', NEW.public_id,
      'project_id', NEW.project_id,
      'project_public_id', v_proj.public_id,
      'workspace_slug', v_proj.workspace_slug,
      'task_number', NEW.task_number,
      'actor_id', v_actor
    )
  );

  RETURN NULL;
END;
$$;

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

  SELECT t.id, t.public_id, t.project_id, t.title,
         p.public_id AS project_public_id,
         w.slug      AS workspace_slug
  INTO v_task
  FROM tasks t
  JOIN projects p   ON p.id = t.project_id
  JOIN workspaces w ON w.id = p.workspace_id
  WHERE t.id = NEW.task_id;

  INSERT INTO notifications (organization_id, user_id, type, title, body, data)
  VALUES (
    NEW.organization_id,
    NEW.assignee_id,
    'task_assigned',
    NEW.title,
    COALESCE(v_task.title, 'A task'),
    jsonb_build_object(
      'task_id', NEW.task_id,
      'task_public_id', v_task.public_id,
      'subtask_id', NEW.id,
      'subtask_public_id', NEW.public_id,
      'project_id', v_task.project_id,
      'project_public_id', v_task.project_public_id,
      'workspace_slug', v_task.workspace_slug,
      'actor_id', v_actor
    )
  );

  RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- Mention autocomplete
-- -----------------------------------------------------------------------------

/*
 * People the caller may mention on a given task.
 *
 * Restricted to the task's project membership, and to its workspace, for the
 * same reason the trigger is: the picker must not become a directory of every
 * account in the organization. SECURITY INVOKER, so RLS on org_members and
 * profiles still applies and a caller outside the org sees nothing.
 */
CREATE OR REPLACE FUNCTION public.mentionable_members(p_task_id uuid, p_query text DEFAULT '')
RETURNS TABLE (id uuid, full_name text, avatar_url text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT pr.id, pr.full_name, pr.avatar_url
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  JOIN profiles pr ON pr.id IN (
    SELECT pm.user_id FROM project_members pm WHERE pm.project_id = t.project_id
    UNION
    SELECT wm.user_id FROM workspace_members wm WHERE wm.workspace_id = p.workspace_id
  )
  WHERE t.id = p_task_id
    AND (
      p_query = ''
      -- Escape the LIKE wildcards so a literal % does not match everyone.
      OR pr.full_name ILIKE '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
  ORDER BY pr.full_name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.mentionable_members(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mentionable_members(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mentionable_members(uuid, text) TO authenticated;
