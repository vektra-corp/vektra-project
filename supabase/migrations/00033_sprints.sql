-- =============================================================================
-- 00033_sprints
--
-- §19: the Planning view commits backlog items to a sprint, and the board's
-- header chip reads "SPRINT 24 · 6D LEFT". Neither had anywhere to come from —
-- there was no sprint anywhere in the schema.
--
-- This is the smallest table that makes planning real: a named, dated window
-- per project, and a nullable pointer from a task to the one it is committed
-- to. Deliberately NOT modelled here:
--
--   * Velocity and capacity. Both are derived — velocity from completed points
--     per past sprint, capacity from the team in it. Storing either would let
--     it drift from the tasks it summarises.
--   * Epics. The design groups the backlog by "Epic · Cutover", but that is
--     what `labels` already is in this schema: a project-scoped, coloured
--     grouping of tasks. A second table with the same shape would be a synonym,
--     so Planning groups by label and the design's epic reads as a label.
--
-- Backward-compatible per §15: a new table plus one nullable column, so every
-- existing query keeps working and a task with no sprint is simply backlog.
-- =============================================================================

CREATE TABLE sprints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            text NOT NULL,
  goal            text,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  status          text NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned', 'active', 'completed')),
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, name),
  CONSTRAINT sprint_dates_ordered CHECK (ends_on >= starts_on)
);

CREATE INDEX idx_sprints_project ON sprints(project_id);
CREATE INDEX idx_sprints_org ON sprints(organization_id);

-- One active sprint per project. A second would make "the current sprint"
-- ambiguous for the board chip and for every velocity sum built on it later.
CREATE UNIQUE INDEX idx_sprints_one_active
  ON sprints(project_id)
  WHERE status = 'active';

COMMENT ON TABLE sprints IS
  'A dated delivery window for one project. Velocity and capacity are derived from tasks, never stored here.';

ALTER TABLE tasks
  ADD COLUMN sprint_id uuid REFERENCES sprints(id) ON DELETE SET NULL;

-- Planning reads "everything in this project with no sprint", so the backlog
-- half of this index matters as much as the committed half.
CREATE INDEX idx_tasks_sprint ON tasks(sprint_id);
CREATE INDEX idx_tasks_backlog ON tasks(project_id) WHERE sprint_id IS NULL;

COMMENT ON COLUMN tasks.sprint_id IS
  'The sprint this task is committed to. NULL means it is still backlog.';

-- ===== RLS =====
-- Read follows the project, exactly as tasks do: seeing a sprint is seeing a
-- fact about a project, so anyone who can reach the project can read its
-- sprints and nobody else can. Writing is a planning act, so it takes manager.
ALTER TABLE sprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see sprints in accessible projects" ON sprints
  FOR SELECT USING (
    organization_id = public.org_id() AND public.can_access_project(project_id)
  );

CREATE POLICY "Managers create sprints" ON sprints
  FOR INSERT WITH CHECK (
    organization_id = public.org_id()
    AND public.can_access_project(project_id)
    AND public.has_org_role('manager')
  );

CREATE POLICY "Managers update sprints" ON sprints
  FOR UPDATE USING (
    organization_id = public.org_id()
    AND public.can_access_project(project_id)
    AND public.has_org_role('manager')
  )
  WITH CHECK (
    organization_id = public.org_id()
    AND public.can_access_project(project_id)
    AND public.has_org_role('manager')
  );

CREATE POLICY "Managers delete sprints" ON sprints
  FOR DELETE USING (
    organization_id = public.org_id() AND public.has_org_role('manager')
  );

-- Picks up every table added above that carries updated_at.
SELECT public.apply_updated_at_triggers();
