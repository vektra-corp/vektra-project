-- =============================================================================
-- 00017_dashboard_configs
--
-- Saved dashboard layouts. claude.md §19.10.
--
-- A layout is per person per organization: two people in the same tenant keep
-- different dashboards, and the same person keeps different ones in each tenant
-- they belong to.
-- =============================================================================

CREATE TABLE dashboard_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'My Dashboard' CHECK (length(trim(name)) > 0),
  is_default      boolean NOT NULL DEFAULT false,

  -- [{ "widget_id": "w1", "type": "tasks_due", "x": 0, "y": 0, "w": 6, "h": 4,
  --    "config": { "project_id": null } }, ...]
  --
  -- Stored as jsonb rather than a widgets table: a layout is only ever read and
  -- written whole, and the grid library round-trips the entire array on every
  -- drag. Splitting it into rows would buy nothing and cost a join per render.
  layout          jsonb NOT NULL DEFAULT '[]',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, user_id, name),
  -- The layout is a list of widget placements, never an object.
  CHECK (jsonb_typeof(layout) = 'array')
);

CREATE INDEX idx_dashboard_configs_owner ON dashboard_configs(organization_id, user_id);

-- One default per person per organization. A partial unique index rather than a
-- constraint, so a person may keep several layouts with only one marked default.
CREATE UNIQUE INDEX idx_dashboard_configs_default
  ON dashboard_configs(organization_id, user_id) WHERE is_default;

ALTER TABLE dashboard_configs ENABLE ROW LEVEL SECURITY;

-- A dashboard is private. There is no sharing policy here on purpose: §19.10
-- describes an admin-set org default, which is a template applied at creation
-- time, not a row other people read.
CREATE POLICY "Users manage their own dashboards" ON dashboard_configs
  FOR ALL USING (organization_id = public.org_id() AND user_id = auth.uid())
  WITH CHECK (organization_id = public.org_id() AND user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_configs TO authenticated;

SELECT public.apply_updated_at_triggers();
