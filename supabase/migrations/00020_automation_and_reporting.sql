-- =============================================================================
-- 00020_automation_and_reporting
--
-- Auto-assignment rules (§19.6), saved report configurations (§19.7), and the
-- revenue rollup the dashboard widgets read (§19.9).
-- =============================================================================

CREATE TABLE auto_assignment_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id    uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  is_active       boolean NOT NULL DEFAULT true,

  trigger_event   text NOT NULL DEFAULT 'task_created'
                  CHECK (trigger_event IN ('task_created', 'task_unassigned', 'status_changed')),
  -- { "labels": ["bug"], "priority": ["high", "critical"] }
  conditions      jsonb NOT NULL DEFAULT '{}',

  method          text NOT NULL DEFAULT 'round_robin'
                  CHECK (method IN ('round_robin', 'load_balanced', 'skill_based', 'random')),
  assignee_pool   uuid[] NOT NULL DEFAULT '{}',
  -- round_robin: { "last_index": 2 } · load_balanced: { "max_concurrent": 10 }
  -- skill_based: { "required_skills": [...], "fallback": "round_robin" }
  config          jsonb NOT NULL DEFAULT '{}',

  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- A rule with nobody to assign to would silently never fire; make that an
  -- error at write time rather than a mystery at run time.
  --
  -- cardinality(), not array_length(): the latter returns NULL for an empty
  -- array, and a CHECK evaluating to NULL is treated as satisfied — so the
  -- constraint would pass for exactly the case it exists to reject.
  CHECK (NOT is_active OR cardinality(assignee_pool) > 0),
  CHECK (jsonb_typeof(conditions) = 'object' AND jsonb_typeof(config) = 'object')
);

CREATE INDEX idx_auto_rules_org ON auto_assignment_rules(organization_id);
CREATE INDEX idx_auto_rules_project ON auto_assignment_rules(project_id)
  WHERE is_active;

-- -----------------------------------------------------------------------------
-- Saved reports (§19.7)
-- -----------------------------------------------------------------------------

CREATE TABLE saved_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  entity_type     text NOT NULL DEFAULT 'task'
                  CHECK (entity_type IN ('task', 'timesheet', 'lead', 'commercial', 'employee')),
  columns         text[] NOT NULL DEFAULT '{}',
  filters         jsonb NOT NULL DEFAULT '{}',
  sort_by         text,
  sort_order      text NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
  group_by        text,
  is_shared       boolean NOT NULL DEFAULT false,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, created_by, name),
  CHECK (jsonb_typeof(filters) = 'object'),
  -- cardinality(), not array_length() — see the note on auto_assignment_rules.
  CHECK (cardinality(columns) > 0)
);

CREATE INDEX idx_saved_reports_owner ON saved_reports(organization_id, created_by);

-- One default per person per entity type, so opening "tasks" lands somewhere
-- predictable without constraining the other report kinds.
CREATE UNIQUE INDEX idx_saved_reports_default
  ON saved_reports(organization_id, created_by, entity_type) WHERE is_default;

-- -----------------------------------------------------------------------------
-- Revenue rollup (§19.9)
--
-- A materialized view rather than a live query: the dashboard reads it on every
-- load, and the underlying scan grows with every document ever issued. Refreshed
-- by an Inngest cron rather than on write.
-- -----------------------------------------------------------------------------

CREATE MATERIALIZED VIEW revenue_summary AS
SELECT
  cd.organization_id,
  date_trunc('month', cd.issue_date)::date AS month,
  cd.currency,
  SUM(CASE WHEN cd.doc_type = 'invoice' AND cd.status = 'paid'
           THEN cd.grand_total ELSE 0 END) AS invoiced_revenue,
  SUM(CASE WHEN cd.doc_type = 'invoice' AND cd.status IN ('sent', 'viewed', 'partially_paid')
           THEN cd.grand_total - cd.amount_paid ELSE 0 END) AS outstanding_invoices,
  SUM(CASE WHEN cd.doc_type = 'invoice' AND cd.status = 'overdue'
           THEN cd.grand_total - cd.amount_paid ELSE 0 END) AS overdue_invoices,
  SUM(CASE WHEN cd.doc_type = 'quotation' AND cd.status IN ('sent', 'viewed')
           THEN cd.grand_total ELSE 0 END) AS pipeline_quotations,
  SUM(CASE WHEN cd.doc_type = 'quotation' AND cd.status = 'accepted'
           THEN cd.grand_total ELSE 0 END) AS accepted_quotations
FROM commercial_documents cd
GROUP BY cd.organization_id, date_trunc('month', cd.issue_date), cd.currency;

-- REFRESH CONCURRENTLY requires a unique index and is what the cron uses, so
-- readers are never blocked while the rollup rebuilds.
CREATE UNIQUE INDEX idx_revenue_summary
  ON revenue_summary(organization_id, month, currency);

/**
 * Refresh the rollup.
 *
 * SECURITY DEFINER because REFRESH requires ownership of the view, which an
 * end-user role does not have. Callable only by service_role: the background
 * job is the sole caller, and letting any session trigger a full rebuild would
 * be a cheap way to load the database.
 */
CREATE OR REPLACE FUNCTION public.refresh_revenue_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY revenue_summary;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_revenue_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_revenue_summary() FROM anon;
REVOKE ALL ON FUNCTION public.refresh_revenue_summary() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_revenue_summary() TO service_role;

/**
 * Revenue for one organization.
 *
 * A materialized view cannot carry RLS, so it is not exposed directly. This
 * SECURITY INVOKER function filters to the caller's own tenant using the same
 * `org_id()` claim every policy reads — a caller can only ever ask about the
 * organization they are already in.
 */
CREATE OR REPLACE FUNCTION public.revenue_for_org(p_months integer DEFAULT 12)
RETURNS TABLE (
  month date,
  currency text,
  invoiced_revenue numeric,
  outstanding_invoices numeric,
  overdue_invoices numeric,
  pipeline_quotations numeric,
  accepted_quotations numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.month, r.currency, r.invoiced_revenue, r.outstanding_invoices,
         r.overdue_invoices, r.pipeline_quotations, r.accepted_quotations
  FROM revenue_summary r
  WHERE r.organization_id = public.org_id()
    AND r.month >= date_trunc('month', CURRENT_DATE)::date
                   - (GREATEST(p_months, 1) || ' months')::interval
  ORDER BY r.month DESC;
$$;

GRANT EXECUTE ON FUNCTION public.revenue_for_org(integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

ALTER TABLE auto_assignment_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read assignment rules" ON auto_assignment_rules
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Managers manage assignment rules" ON auto_assignment_rules
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own and shared reports" ON saved_reports
  FOR SELECT USING (
    organization_id = public.org_id()
    AND (created_by = auth.uid() OR is_shared)
  );

-- A report is owned by its creator. Sharing it does not hand over editing.
CREATE POLICY "Users manage their own reports" ON saved_reports
  FOR ALL USING (organization_id = public.org_id() AND created_by = auth.uid())
  WITH CHECK (organization_id = public.org_id() AND created_by = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON auto_assignment_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reports TO authenticated;

SELECT public.apply_updated_at_triggers();
