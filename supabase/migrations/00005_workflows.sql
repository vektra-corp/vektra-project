-- =============================================================================
-- 00005_workflows
--
-- Visual workflow definitions and their execution log. claude.md §6.5, §11.
-- Execution limits (50 steps, 5 minutes, 3 retries) are enforced by the engine
-- in @pm/shared/constants; the schema records what actually happened.
-- =============================================================================

CREATE TABLE workflows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  description     text,
  is_active       boolean NOT NULL DEFAULT false,
  trigger_type    text NOT NULL
                  CHECK (trigger_type IN ('task_event', 'subtask_event', 'commercial_event',
                         'webhook', 'schedule', 'manual')),
  trigger_config  jsonb NOT NULL DEFAULT '{}',   -- Event type, filters, schedule expression
  graph           jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  -- Unique path segment for webhook-triggered workflows.
  webhook_token   text UNIQUE,
  cron_expression text,
  last_run_at     timestamptz,
  run_count       integer NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- A webhook workflow needs a token; a scheduled one needs a cron expression.
  CHECK (trigger_type <> 'webhook' OR webhook_token IS NOT NULL),
  CHECK (trigger_type <> 'schedule' OR cron_expression IS NOT NULL)
);

CREATE INDEX idx_workflows_org ON workflows(organization_id);
CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);
-- The dispatcher scans active workflows by trigger type on every event.
CREATE INDEX idx_workflows_active_trigger ON workflows(organization_id, trigger_type)
  WHERE is_active;

-- Mint a webhook token when a webhook-triggered workflow is created without one.
CREATE OR REPLACE FUNCTION public.ensure_webhook_token()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trigger_type = 'webhook' AND NEW.webhook_token IS NULL THEN
    NEW.webhook_token = encode(gen_random_bytes(24), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ensure_webhook_token_trigger
  BEFORE INSERT OR UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION public.ensure_webhook_token();

-- -----------------------------------------------------------------------------
-- Workflow runs
-- -----------------------------------------------------------------------------

CREATE TABLE workflow_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'completed', 'failed', 'timed_out', 'cancelled')),
  trigger_data    jsonb NOT NULL,     -- Snapshot of the event that started the run
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     integer,
  error           text,
  step_count      integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at DESC);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(organization_id, status);
CREATE INDEX idx_workflow_runs_org ON workflow_runs(organization_id, started_at DESC);

-- Keep workflows.run_count and last_run_at accurate without a second write from
-- the engine.
-- SECURITY DEFINER: run bookkeeping on the parent workflow row, independent of
-- whoever (or whatever) triggered the run.
CREATE OR REPLACE FUNCTION public.bump_workflow_run_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE workflows
     SET run_count   = run_count + 1,
         last_run_at = NEW.started_at
   WHERE id = NEW.workflow_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bump_workflow_run_stats_trigger
  AFTER INSERT ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.bump_workflow_run_stats();

-- -----------------------------------------------------------------------------
-- Per-step execution detail
-- -----------------------------------------------------------------------------

CREATE TABLE workflow_step_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_id         text NOT NULL,      -- Node ID within the workflow graph JSON
  node_type       text NOT NULL,
  input           jsonb,
  output          jsonb,
  status          text NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error           text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     integer
);

CREATE INDEX idx_workflow_step_logs_run ON workflow_step_logs(run_id, started_at);
CREATE INDEX idx_workflow_step_logs_org ON workflow_step_logs(organization_id);

SELECT public.apply_updated_at_triggers();
