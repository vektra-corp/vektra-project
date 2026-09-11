-- Project-level governance: per-project notification control.
--
-- `notification_preferences` (00007) answers "how does this person want to be
-- notified in this ORGANIZATION?". It cannot answer "…about THIS PROJECT?",
-- which is the question someone on six projects actually has: they want the
-- one they are on call for to email them and the other five to stay in the
-- inbox. Adding a project column to that table would have meant a nullable
-- foreign key acting as a discriminator and a composite unique index with a
-- NULL in it — so this is its own table, and the org-level row stays the
-- default it always was.
--
-- Resolution order, applied in application code:
--   project row -> organization row -> built-in default
-- An absent project row means "no opinion", NOT "off": silence has to be
-- chosen, never inherited by accident.

CREATE TABLE project_notification_preferences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- { "task_assigned": { "email": true, "in_app": true }, ... }
  -- Partial by design: a type that is absent falls through to the org row.
  preferences     jsonb NOT NULL DEFAULT '{}',
  -- The blunt instrument, and the one most people will reach for: mute the
  -- whole project without having to reason about individual event types.
  muted           boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX idx_project_notif_prefs_user
  ON project_notification_preferences(user_id, organization_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON project_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE project_notification_preferences ENABLE ROW LEVEL SECURITY;

-- "Controlled by anyone" means anyone controls their OWN. A manager must not be
-- able to decide what a member hears about, and must not be able to read it
-- either — a notification setting is a statement about attention, not a
-- project asset. Hence `user_id = auth.uid()` on both sides rather than a
-- role check.
CREATE POLICY "Users manage their own project notification preferences"
  ON project_notification_preferences
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = public.org_id()
    AND public.can_access_project(project_id)
  );

COMMENT ON TABLE project_notification_preferences IS
  'Per-user, per-project notification overrides. Falls back to notification_preferences, then to the built-in default. Readable and writable only by the user it belongs to.';
