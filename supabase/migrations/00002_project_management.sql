-- =============================================================================
-- 00002_project_management
--
-- Projects, Kanban boards, tasks, subtasks, dependencies. claude.md §6.2.
--
-- kanban_boards and tasks reference each other (a board can hang off a task for
-- the subtask board), so the board -> task foreign key is added after tasks exist.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Projects
-- -----------------------------------------------------------------------------

CREATE TABLE projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(trim(name)) > 0),
  description      text,
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
  priority         text DEFAULT 'medium'
                   CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  start_date       date,
  end_date         date,
  budget           numeric(12, 2) CHECK (budget IS NULL OR budget >= 0),
  visibility       text NOT NULL DEFAULT 'workspace'
                   CHECK (visibility IN ('workspace', 'organization')),
  settings         jsonb NOT NULL DEFAULT '{}',
  -- High-water mark for per-project task numbering. See next_task_number().
  last_task_number integer NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

CREATE INDEX idx_projects_org ON projects(organization_id);
CREATE INDEX idx_projects_workspace ON projects(workspace_id);
CREATE INDEX idx_projects_status ON projects(organization_id, status);

-- -----------------------------------------------------------------------------
-- Project members
-- -----------------------------------------------------------------------------

CREATE TABLE project_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'contributor'
                  CHECK (role IN ('owner', 'contributor', 'viewer')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_org ON project_members(organization_id);

-- Membership helper, declared here because it needs project_members to exist.
CREATE OR REPLACE FUNCTION public.is_project_member(proj_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = proj_id AND user_id = auth.uid()
  );
$$;

-- Can the current user see this project at all? Either it is org-visible, or
-- they belong to its workspace, or they are named on the project itself.
CREATE OR REPLACE FUNCTION public.can_access_project(proj_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = proj_id
      AND p.organization_id = public.org_id()
      AND (
        p.visibility = 'organization'
        OR public.is_workspace_member(p.workspace_id)
        OR public.is_project_member(p.id)
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- Portal project access (§6.1 — the allowlist for external users)
--
-- Declared here because it references projects. Business rule 6: if the row is
-- absent, the portal user sees nothing. There is no implicit access.
-- -----------------------------------------------------------------------------

CREATE TABLE portal_project_access (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id  uuid NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  can_comment     boolean NOT NULL DEFAULT true,
  can_upload      boolean NOT NULL DEFAULT false,
  granted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_user_id, project_id)
);

CREATE INDEX idx_portal_access_project ON portal_project_access(project_id);
CREATE INDEX idx_portal_access_org ON portal_project_access(organization_id);

CREATE OR REPLACE FUNCTION public.portal_can_access_project(proj_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM portal_project_access ppa
    JOIN portal_users pu ON pu.id = ppa.portal_user_id
    WHERE ppa.project_id = proj_id
      AND pu.user_id = auth.uid()
      AND pu.status = 'active'
  );
$$;

-- -----------------------------------------------------------------------------
-- Kanban boards and columns
-- -----------------------------------------------------------------------------

CREATE TABLE kanban_boards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  task_id         uuid,  -- FK added after tasks exists
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'Board',
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (project_id IS NOT NULL AND task_id IS NULL) OR
    (project_id IS NULL AND task_id IS NOT NULL)
  )
);

CREATE INDEX idx_kanban_boards_project ON kanban_boards(project_id);
CREATE INDEX idx_kanban_boards_task ON kanban_boards(task_id);
CREATE INDEX idx_kanban_boards_org ON kanban_boards(organization_id);

-- One default board per project and per task.
CREATE UNIQUE INDEX idx_kanban_boards_default_project
  ON kanban_boards(project_id) WHERE is_default AND project_id IS NOT NULL;
CREATE UNIQUE INDEX idx_kanban_boards_default_task
  ON kanban_boards(task_id) WHERE is_default AND task_id IS NOT NULL;

CREATE TABLE kanban_columns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id        uuid NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  color           text,
  position        integer NOT NULL DEFAULT 0,
  wip_limit       integer CHECK (wip_limit IS NULL OR wip_limit > 0),
  is_done_column  boolean NOT NULL DEFAULT false,
  -- Business rule 3: a column IS a status. Moving a card sets both.
  status          text NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kanban_columns_board ON kanban_columns(board_id, position);
CREATE INDEX idx_kanban_columns_org ON kanban_columns(organization_id);

COMMENT ON COLUMN kanban_columns.status IS
  'Task status this column maps to. Dragging a card writes both kanban_column_id and status (business rule 3).';

-- -----------------------------------------------------------------------------
-- Labels
-- -----------------------------------------------------------------------------

CREATE TABLE labels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = org-wide
  name            text NOT NULL,
  color           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_labels_org ON labels(organization_id);
CREATE INDEX idx_labels_project ON labels(project_id);

-- -----------------------------------------------------------------------------
-- Tasks
-- -----------------------------------------------------------------------------

CREATE TABLE tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kanban_column_id uuid REFERENCES kanban_columns(id) ON DELETE SET NULL,
  title            text NOT NULL CHECK (length(trim(title)) > 0),
  description      jsonb,             -- Tiptap JSON, sanitized before storage (§13.1)
  status           text NOT NULL DEFAULT 'todo'
                   CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  priority         text NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  assignee_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigner_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  start_date       date,
  due_date         date,
  estimated_hours  numeric(6, 2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  actual_hours     numeric(6, 2) CHECK (actual_hours IS NULL OR actual_hours >= 0),
  position         integer NOT NULL DEFAULT 0,
  task_number      integer NOT NULL,
  is_milestone     boolean NOT NULL DEFAULT false,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date),
  -- Business rule 1: numbers are unique per project and never recycled.
  UNIQUE (project_id, task_number)
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_org ON tasks(organization_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_tasks_column ON tasks(kanban_column_id, position);
CREATE INDEX idx_tasks_title ON tasks USING gin (title gin_trgm_ops);

-- Partial indexes for the hot paths (§23.1)
CREATE INDEX idx_tasks_open ON tasks(project_id, assignee_id)
  WHERE status NOT IN ('done', 'cancelled');

CREATE INDEX idx_tasks_overdue ON tasks(due_date)
  WHERE status NOT IN ('done', 'cancelled') AND due_date IS NOT NULL;

-- Now that tasks exists, close the board -> task reference.
ALTER TABLE kanban_boards
  ADD CONSTRAINT kanban_boards_task_id_fkey
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- Task numbering (business rule 1)
--
-- The obvious MAX(task_number) + 1 races under concurrent inserts and can
-- produce duplicates. Incrementing a counter on the project row takes a row
-- lock for the duration of the transaction, so concurrent inserts serialize on
-- that one row and every task gets a distinct, never-reused number.
-- -----------------------------------------------------------------------------

-- SECURITY DEFINER because the counter bump is the database's own bookkeeping,
-- not a user action. Without it, RLS on `projects` (UPDATE requires manager)
-- would block a plain member from creating a task in their own project, and the
-- column-level revoke on last_task_number would block everyone.
-- Authorization for the insert itself is unaffected: the tasks INSERT policy
-- still decides whether the row may be written at all.
CREATE OR REPLACE FUNCTION public.set_task_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE projects
     SET last_task_number = last_task_number + 1
   WHERE id = NEW.project_id
  RETURNING last_task_number INTO NEW.task_number;

  IF NEW.task_number IS NULL THEN
    RAISE EXCEPTION 'Cannot assign task number: project % not found', NEW.project_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER set_task_number_trigger
  BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_task_number();

-- -----------------------------------------------------------------------------
-- Automatic started_at / completed_at (§19.7)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_set_task_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- First transition into in_progress stamps the real start.
  IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress'
     AND NEW.started_at IS NULL THEN
    NEW.started_at = now();
  END IF;

  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    NEW.completed_at = now();
  END IF;

  -- Reopening clears the completion stamp.
  IF NEW.status <> 'done' AND OLD.status = 'done' THEN
    NEW.completed_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER auto_task_timestamps
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_task_timestamps();

-- -----------------------------------------------------------------------------
-- Task labels
-- -----------------------------------------------------------------------------

CREATE TABLE task_labels (
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id        uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE INDEX idx_task_labels_label ON task_labels(label_id);
CREATE INDEX idx_task_labels_org ON task_labels(organization_id);

-- -----------------------------------------------------------------------------
-- Subtasks
--
-- Business rule 2: two levels only. There is no parent_id here, so a subtask
-- cannot own another subtask — the schema makes the rule unbreakable.
-- -----------------------------------------------------------------------------

CREATE TABLE subtasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id          uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kanban_column_id uuid REFERENCES kanban_columns(id) ON DELETE SET NULL,
  title            text NOT NULL CHECK (length(trim(title)) > 0),
  description      jsonb,
  status           text NOT NULL DEFAULT 'todo'
                   CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  priority         text NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  assignee_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date         date,
  estimated_hours  numeric(6, 2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  position         integer NOT NULL DEFAULT 0,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subtasks_task ON subtasks(task_id);
CREATE INDEX idx_subtasks_org ON subtasks(organization_id);
CREATE INDEX idx_subtasks_assignee ON subtasks(assignee_id);
CREATE INDEX idx_subtasks_column ON subtasks(kanban_column_id, position);

CREATE TRIGGER auto_subtask_timestamps
  BEFORE UPDATE ON subtasks
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_task_timestamps();

-- -----------------------------------------------------------------------------
-- Task dependencies (Gantt)
-- -----------------------------------------------------------------------------

CREATE TABLE task_dependencies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  predecessor_id  uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type text NOT NULL DEFAULT 'finish_to_start'
                  CHECK (dependency_type IN ('finish_to_start', 'start_to_start',
                         'finish_to_finish', 'start_to_finish')),
  lag_days        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (predecessor_id, successor_id),
  CHECK (predecessor_id <> successor_id)
);

CREATE INDEX idx_task_deps_predecessor ON task_dependencies(predecessor_id);
CREATE INDEX idx_task_deps_successor ON task_dependencies(successor_id);
CREATE INDEX idx_task_deps_org ON task_dependencies(organization_id);

-- Reject a dependency that would close a cycle. Without this the Gantt renderer
-- and any scheduling pass can loop forever.
-- SECURITY DEFINER so the walk sees every edge in the graph. Under RLS the
-- caller might not see a task that closes the loop, and the cycle would slip in.
CREATE OR REPLACE FUNCTION public.check_dependency_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  creates_cycle boolean;
BEGIN
  WITH RECURSIVE downstream AS (
    SELECT successor_id AS task_id
    FROM task_dependencies
    WHERE predecessor_id = NEW.successor_id
    UNION
    SELECT td.successor_id
    FROM task_dependencies td
    JOIN downstream d ON td.predecessor_id = d.task_id
  )
  SELECT EXISTS (SELECT 1 FROM downstream WHERE task_id = NEW.predecessor_id)
  INTO creates_cycle;

  IF creates_cycle THEN
    RAISE EXCEPTION 'Dependency would create a cycle'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER check_dependency_cycle_trigger
  BEFORE INSERT OR UPDATE ON task_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.check_dependency_cycle();

-- -----------------------------------------------------------------------------
-- Default board for every new project
-- -----------------------------------------------------------------------------

-- SECURITY DEFINER: scaffolding the board is system bookkeeping that must
-- succeed for any caller allowed to create the project.
CREATE OR REPLACE FUNCTION public.create_default_board()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  board_id uuid;
BEGIN
  INSERT INTO kanban_boards (project_id, organization_id, name, is_default)
  VALUES (NEW.id, NEW.organization_id, 'Board', true)
  RETURNING id INTO board_id;

  INSERT INTO kanban_columns (board_id, organization_id, name, position, status, is_done_column, color)
  VALUES
    (board_id, NEW.organization_id, 'To Do',       0, 'todo',        false, '#94A3B8'),
    (board_id, NEW.organization_id, 'In Progress', 1, 'in_progress', false, '#3B82F6'),
    (board_id, NEW.organization_id, 'In Review',   2, 'in_review',   false, '#A855F7'),
    (board_id, NEW.organization_id, 'Done',        3, 'done',        true,  '#22C55E');

  RETURN NEW;
END;
$$;

CREATE TRIGGER create_default_board_trigger
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION public.create_default_board();

SELECT public.apply_updated_at_triggers();
