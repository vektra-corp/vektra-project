-- Sortable priority.
--
-- `priority` is text with a CHECK constraint, so Postgres orders it
-- alphabetically: critical, high, low, medium. That puts "low" above "medium",
-- which is not a priority order in any reading. Every caller that wanted
-- urgency-first had to pull the whole set and sort it in memory, which works
-- only while nothing paginates — the moment a list takes the first 50 rows,
-- an alphabetical sort hands back the wrong 50.
--
-- A generated column makes the rank a property of the row, so ORDER BY and
-- LIMIT agree with each other and an index can serve both.
--
-- STORED rather than a view or an expression index alone: PostgREST orders by
-- column name, and this is the only form it can address.

ALTER TABLE tasks
  ADD COLUMN priority_rank smallint
  GENERATED ALWAYS AS (
    CASE priority
      WHEN 'critical' THEN 0
      WHEN 'high'     THEN 1
      WHEN 'medium'   THEN 2
      WHEN 'low'      THEN 3
      ELSE 9
    END
  ) STORED;

ALTER TABLE subtasks
  ADD COLUMN priority_rank smallint
  GENERATED ALWAYS AS (
    CASE priority
      WHEN 'critical' THEN 0
      WHEN 'high'     THEN 1
      WHEN 'medium'   THEN 2
      WHEN 'low'      THEN 3
      ELSE 9
    END
  ) STORED;

COMMENT ON COLUMN tasks.priority_rank IS
  'Sort weight for priority: 0 = critical … 3 = low. Generated, never written directly. Mirrors PRIORITY_WEIGHT in packages/shared.';

-- The board and list both read "urgent work in this project, open first".
CREATE INDEX idx_tasks_project_priority
  ON tasks(project_id, priority_rank, position)
  WHERE status NOT IN ('done', 'cancelled');

CREATE INDEX idx_subtasks_task_priority
  ON subtasks(task_id, priority_rank, position);

-- 00040 re-granted late-added columns for the same reason: a column added after
-- the original GRANT is not covered by it, so `authenticated` cannot read it
-- and every select naming it fails. Generated columns are read-only, so SELECT
-- is the only grant that applies.
GRANT SELECT (priority_rank) ON tasks TO authenticated, anon, service_role;
GRANT SELECT (priority_rank) ON subtasks TO authenticated, anon, service_role;
