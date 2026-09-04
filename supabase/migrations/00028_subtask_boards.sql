-- =============================================================================
-- 00028_subtask_boards
--
-- Subtask-level Kanban (§20 Phase 2, §17 `subtask_kanban`).
--
-- The schema has supported this since 00002: `kanban_boards.task_id` exists
-- with a CHECK making it exclusive with `project_id`, `subtasks.kanban_column_id`
-- and `subtasks.position` exist, and a partial unique index already allows one
-- default board per task. Nothing ever created those rows.
--
-- Boards are provisioned ON DEMAND, not by a trigger on tasks. `create_default_
-- board` fires for every project, which is fine — there are thousands. A task
-- trigger would mint a board and four columns for every task ever created, the
-- overwhelming majority of which have no subtasks at all.
--
-- Provisioning also has to adopt the subtasks that already exist. A task may
-- have had subtasks for months as a checklist; opening the board for the first
-- time must show them, in the column matching the status they already hold,
-- rather than an empty board beside a populated list.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_task_board(p_task_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_board uuid;
  v_org   uuid;
BEGIN
  -- SECURITY DEFINER bypasses RLS, so the tenant check is explicit. Without it
  -- this would create boards inside any organisation, given only a task id.
  SELECT t.organization_id INTO v_org
  FROM tasks t
  WHERE t.id = p_task_id AND t.organization_id = public.org_id();

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT b.id INTO v_board
  FROM kanban_boards b
  WHERE b.task_id = p_task_id AND b.is_default;

  IF v_board IS NOT NULL THEN
    RETURN v_board;
  END IF;

  INSERT INTO kanban_boards (task_id, organization_id, name, is_default)
  VALUES (p_task_id, v_org, 'Subtasks', true)
  RETURNING id INTO v_board;

  -- The same four stages as a project board, so a subtask board reads the same
  -- way and `status` keeps one meaning across both (business rule 3).
  INSERT INTO kanban_columns (board_id, organization_id, name, position, status, is_done_column, color)
  VALUES
    (v_board, v_org, 'To Do',       0, 'todo',        false, '#94A3B8'),
    (v_board, v_org, 'In Progress', 1, 'in_progress', false, '#3B82F6'),
    (v_board, v_org, 'In Review',   2, 'in_review',   false, '#A855F7'),
    (v_board, v_org, 'Done',        3, 'done',        true,  '#22C55E');

  -- Adopt existing subtasks into the column their status already implies.
  -- `cancelled` has no column of its own on either board shape, so those land
  -- in To Do rather than vanishing from the board entirely.
  UPDATE subtasks s
     SET kanban_column_id = c.id
    FROM kanban_columns c
   WHERE s.task_id = p_task_id
     AND s.kanban_column_id IS NULL
     AND c.board_id = v_board
     AND c.status = CASE WHEN s.status = 'cancelled' THEN 'todo' ELSE s.status END;

  RETURN v_board;
END;
$$;

COMMENT ON FUNCTION public.ensure_task_board(uuid) IS
  'Idempotently provisions a subtask board for a task and adopts existing subtasks into it. Checks the tenant explicitly because SECURITY DEFINER bypasses RLS.';

-- Callable by signed-in users: it is how the subtask board page loads. The
-- tenant check above is what makes that safe.
REVOKE EXECUTE ON FUNCTION public.ensure_task_board(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ensure_task_board(uuid) TO authenticated;

-- Reordering within a column reads subtasks by (column, position); the existing
-- idx_subtasks_column already serves that. What it does not serve is the board
-- query, which fetches every subtask of one task in board order.
CREATE INDEX IF NOT EXISTS idx_subtasks_task_position
  ON subtasks (task_id, position);
