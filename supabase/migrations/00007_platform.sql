-- =============================================================================
-- 00007_platform
--
-- Usage metering, notifications, audit logs, the internal event bus, custom
-- fields, and import/export jobs. claude.md §6.7, §6.9.
--
-- The event bus is the backbone: every mutation on a key table emits an event,
-- which is what powers workflows, integrations, and activity feeds
-- (business rule 7). Removing an emit trigger for performance is not allowed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Usage counters (metered per org)
-- -----------------------------------------------------------------------------

CREATE TABLE usage_counters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric          text NOT NULL,
  current_value   bigint NOT NULL DEFAULT 0,
  limit_value     bigint,             -- NULL = unlimited
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, metric, period_start)
);

CREATE INDEX idx_usage_counters_org ON usage_counters(organization_id, metric);

-- Atomic increment so two concurrent creates cannot both slip under a limit.
CREATE OR REPLACE FUNCTION public.increment_usage(
  org uuid,
  p_metric text,
  p_delta bigint DEFAULT 1
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start date := date_trunc('month', CURRENT_DATE)::date;
  v_period_end   date := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
  v_value        bigint;
BEGIN
  INSERT INTO usage_counters (organization_id, metric, current_value, period_start, period_end)
  VALUES (org, p_metric, GREATEST(p_delta, 0), v_period_start, v_period_end)
  ON CONFLICT (organization_id, metric, period_start)
  DO UPDATE SET current_value = GREATEST(usage_counters.current_value + p_delta, 0),
                updated_at    = now()
  RETURNING current_value INTO v_value;

  RETURN v_value;
END;
$$;

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------

CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            text NOT NULL,
  title           text NOT NULL,
  body            text,
  data            jsonb,              -- { task_id, project_id, comment_id, ... }
  is_read         boolean NOT NULL DEFAULT false,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_org ON notifications(organization_id);

CREATE TABLE notification_preferences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  preferences     jsonb NOT NULL DEFAULT '{}',
  quiet_hours     jsonb,              -- { start, end, timezone }
  digest_mode     text NOT NULL DEFAULT 'instant'
                  CHECK (digest_mode IN ('instant', 'hourly', 'daily')),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

-- -----------------------------------------------------------------------------
-- Audit logs
--
-- Business rule 5: immutable. RLS grants INSERT and SELECT only — there is no
-- UPDATE or DELETE policy anywhere, and the revoke below removes the privilege
-- even from a role that somehow bypassed policy selection.
-- -----------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type      text NOT NULL DEFAULT 'user'
                  CHECK (actor_type IN ('user', 'system', 'admin', 'workflow', 'integration')),
  action          text NOT NULL,      -- 'task.created', 'invoice.approved', ...
  resource_type   text NOT NULL,
  resource_id     uuid,
  changes         jsonb,              -- { "status": { "old": "draft", "new": "sent" } }
  metadata        jsonb,              -- IP address, user agent, request id
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(organization_id, action);

-- The matching REVOKE lives at the end of 00009, after the blanket table grants.

-- Belt and braces: reject any UPDATE or DELETE regardless of the caller's role.
CREATE OR REPLACE FUNCTION public.reject_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (business rule 5)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation();

-- -----------------------------------------------------------------------------
-- Event bus
-- -----------------------------------------------------------------------------

CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      text NOT NULL,      -- 'task.created', 'task.status_changed', ...
  resource_id     uuid,
  actor_id        uuid,
  payload         jsonb NOT NULL,
  source          text NOT NULL DEFAULT 'app'
                  CHECK (source IN ('app', 'workflow', 'integration', 'webhook', 'system')),
  processed       boolean NOT NULL DEFAULT false,
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_org_type ON events(organization_id, event_type, created_at DESC);
CREATE INDEX idx_events_unprocessed ON events(created_at) WHERE processed = false;
CREATE INDEX idx_events_resource ON events(resource_id);

-- Map a table name to the resource noun used in event types (§16 naming rules).
CREATE OR REPLACE FUNCTION public.event_resource_name(table_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE table_name
    WHEN 'tasks'                THEN 'task'
    WHEN 'subtasks'             THEN 'subtask'
    WHEN 'projects'             THEN 'project'
    WHEN 'comments'             THEN 'comment'
    WHEN 'documents'            THEN 'document'
    WHEN 'attachments'          THEN 'attachment'
    WHEN 'commercial_documents' THEN 'commercial_document'
    WHEN 'leads'                THEN 'lead'
    WHEN 'leave_requests'       THEN 'leave_request'
    WHEN 'timesheet_periods'    THEN 'timesheet'
    ELSE rtrim(table_name, 's')
  END;
$$;

-- Field-level diff between OLD and NEW, in the same shape audit_logs.changes uses.
CREATE OR REPLACE FUNCTION public.jsonb_diff(old_row jsonb, new_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_object_agg(k, jsonb_build_object('old', old_row->k, 'new', new_row->k)),
    '{}'::jsonb
  )
  FROM jsonb_object_keys(new_row) AS t(k)
  WHERE old_row->k IS DISTINCT FROM new_row->k
    AND k <> 'updated_at';
$$;

/*
 * Emit an event for every mutation on a key table (business rule 7).
 *
 * The trigger publishes semantic names — task.created, task.status_changed —
 * rather than raw table.operation pairs, so workflow triggers, integrations and
 * activity feeds all speak the vocabulary defined in @pm/shared/constants/events.
 * A single UPDATE can emit more than one event: a status change also emits
 * task.status_changed alongside task.updated.
 */
CREATE OR REPLACE FUNCTION public.emit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_resource text;
  v_new      jsonb;
  v_old      jsonb;
  v_changes  jsonb := '{}'::jsonb;
  v_actor    uuid := auth.uid();
  v_id       uuid;
BEGIN
  v_resource := public.event_resource_name(TG_TABLE_NAME);

  -- NEW is unassigned on DELETE and OLD on INSERT, so each is only touched
  -- inside the branch where it exists. Referencing the other raises at runtime.
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_org := OLD.organization_id;
  ELSE
    v_new := to_jsonb(NEW);
    v_org := NEW.organization_id;
    IF TG_OP = 'UPDATE' THEN
      v_old := to_jsonb(OLD);
    END IF;
  END IF;

  v_id := COALESCE((v_new->>'id')::uuid, (v_old->>'id')::uuid);

  IF TG_OP = 'UPDATE' THEN
    v_changes := public.jsonb_diff(v_old, v_new);
    -- Nothing of substance changed (only updated_at moved). Stay quiet.
    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO events (organization_id, event_type, resource_id, actor_id, payload)
  VALUES (
    v_org,
    v_resource || '.' || CASE TG_OP
      WHEN 'INSERT' THEN 'created'
      WHEN 'UPDATE' THEN 'updated'
      WHEN 'DELETE' THEN 'deleted'
    END,
    v_id,
    v_actor,
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'record_id', v_id,
      'new', v_new,
      'old', v_old,
      'changes', v_changes,
      'actor_id', v_actor,
      'timestamp', now()
    )
  );

  -- Derived events that workflow triggers actually filter on.
  IF TG_OP = 'UPDATE' AND v_changes ? 'status' THEN
    INSERT INTO events (organization_id, event_type, resource_id, actor_id, payload)
    VALUES (
      v_org, v_resource || '.status_changed', v_id, v_actor,
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'record_id', v_id,
        'from', v_changes->'status'->>'old',
        'to', v_changes->'status'->>'new',
        'new', v_new,
        'actor_id', v_actor,
        'timestamp', now()
      )
    );
  END IF;

  IF TG_OP = 'UPDATE' AND v_changes ? 'assignee_id' THEN
    INSERT INTO events (organization_id, event_type, resource_id, actor_id, payload)
    VALUES (
      v_org,
      v_resource || CASE WHEN v_new->>'assignee_id' IS NULL THEN '.unassigned' ELSE '.assigned' END,
      v_id, v_actor,
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'record_id', v_id,
        'previous_assignee_id', v_changes->'assignee_id'->>'old',
        'assignee_id', v_new->>'assignee_id',
        'new', v_new,
        'actor_id', v_actor,
        'timestamp', now()
      )
    );
  END IF;

  -- AFTER ROW trigger: the return value is ignored.
  RETURN NULL;
END;
$$;

-- Attach to the key tables (§6.9).
CREATE TRIGGER emit_task_event
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.emit_event();

CREATE TRIGGER emit_subtask_event
  AFTER INSERT OR UPDATE OR DELETE ON subtasks
  FOR EACH ROW EXECUTE FUNCTION public.emit_event();

CREATE TRIGGER emit_project_event
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION public.emit_event();

CREATE TRIGGER emit_comment_event
  AFTER INSERT OR UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION public.emit_event();

CREATE TRIGGER emit_document_event
  AFTER INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION public.emit_event();

CREATE TRIGGER emit_commercial_event
  AFTER INSERT OR UPDATE ON commercial_documents
  FOR EACH ROW EXECUTE FUNCTION public.emit_event();

-- -----------------------------------------------------------------------------
-- Custom fields
-- -----------------------------------------------------------------------------

CREATE TABLE custom_fields (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     text NOT NULL
                  CHECK (entity_type IN ('task', 'project', 'contact', 'commercial_document')),
  name            text NOT NULL,
  field_type      text NOT NULL
                  CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'checkbox',
                         'url', 'email', 'currency')),
  options         jsonb,              -- Dropdown choices
  is_required     boolean NOT NULL DEFAULT false,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, name)
);

CREATE INDEX idx_custom_fields_org ON custom_fields(organization_id, entity_type, position);

CREATE TABLE custom_field_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_field_id uuid NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id       uuid NOT NULL,
  value           jsonb NOT NULL,
  UNIQUE (custom_field_id, entity_id)
);

CREATE INDEX idx_custom_field_values_entity ON custom_field_values(entity_id);
CREATE INDEX idx_custom_field_values_org ON custom_field_values(organization_id);

-- -----------------------------------------------------------------------------
-- Import / export jobs
-- -----------------------------------------------------------------------------

CREATE TABLE import_export_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('import', 'export')),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  entity_type     text NOT NULL,      -- 'tasks', 'contacts', 'projects'
  file_path       text,
  config          jsonb NOT NULL DEFAULT '{}',
  result          jsonb,              -- { rows_processed, rows_failed, errors: [...] }
  started_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_export_jobs_org ON import_export_jobs(organization_id, created_at DESC);

SELECT public.apply_updated_at_triggers();
