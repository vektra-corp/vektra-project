-- =============================================================================
-- 00012_kanban_views
--
-- Saved, customizable board configurations. claude.md §19.8.
--
-- The board's columns normally come from kanban_columns (grouped by status).
-- A view can instead group by assignee, priority, label or a custom field, in
-- which case the columns are derived at read time and `column_config` only
-- carries presentation (order, colour, WIP limit, collapsed).
-- =============================================================================

CREATE TABLE kanban_view_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_id        uuid NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'Default view',
  is_default      boolean NOT NULL DEFAULT false,
  -- A shared view is visible to every project member; otherwise it is private
  -- to its creator.
  is_shared       boolean NOT NULL DEFAULT false,

  group_by        text NOT NULL DEFAULT 'status'
                  CHECK (group_by IN ('status', 'assignee', 'priority', 'label',
                                      'custom_field', 'due_date_range')),
  group_field_id  uuid REFERENCES custom_fields(id) ON DELETE SET NULL,

  column_config   jsonb NOT NULL DEFAULT '[]',
  card_fields     jsonb NOT NULL DEFAULT
                  '["assignee","priority","due_date","labels","subtask_progress"]',

  card_color_by   text NOT NULL DEFAULT 'priority'
                  CHECK (card_color_by IN ('priority', 'label', 'status', 'custom_field', 'none')),
  card_color_map  jsonb,

  swimlane_by     text NOT NULL DEFAULT 'none'
                  CHECK (swimlane_by IN ('none', 'assignee', 'priority', 'label', 'custom_field')),

  sort_by         text NOT NULL DEFAULT 'position'
                  CHECK (sort_by IN ('position', 'priority', 'due_date', 'created_at', 'title')),
  sort_order      text NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),

  filters         jsonb NOT NULL DEFAULT '{}',

  show_empty_columns boolean NOT NULL DEFAULT true,
  show_column_count  boolean NOT NULL DEFAULT true,
  compact_mode       boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Grouping by a custom field is meaningless without naming the field.
  CHECK (group_by <> 'custom_field' OR group_field_id IS NOT NULL)
);

CREATE INDEX idx_kanban_views_board ON kanban_view_configs(board_id);
CREATE INDEX idx_kanban_views_org ON kanban_view_configs(organization_id);
CREATE INDEX idx_kanban_views_owner ON kanban_view_configs(created_by);

-- One default per person per board, rather than one per board: two people can
-- each have their own preferred starting view.
CREATE UNIQUE INDEX idx_kanban_views_default
  ON kanban_view_configs(board_id, created_by) WHERE is_default;

ALTER TABLE kanban_view_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see their own and shared views" ON kanban_view_configs
  FOR SELECT USING (
    organization_id = public.org_id()
    AND (created_by = auth.uid() OR is_shared)
  );

-- A view is owned by its creator. Sharing it does not hand over editing.
CREATE POLICY "Users manage their own views" ON kanban_view_configs
  FOR ALL USING (organization_id = public.org_id() AND created_by = auth.uid())
  WITH CHECK (organization_id = public.org_id() AND created_by = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON kanban_view_configs TO authenticated;

SELECT public.apply_updated_at_triggers();
