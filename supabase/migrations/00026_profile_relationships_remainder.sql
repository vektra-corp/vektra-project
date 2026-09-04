-- =============================================================================
-- 00026_profile_relationships_remainder
--
-- Finish what 00011 and 00021 started: every remaining user-referencing foreign
-- key that a query might embed now points at public.profiles instead of
-- auth.users.
--
-- Same reason as before, and it is worth restating because it keeps recurring:
-- PostgREST can only embed across a foreign key, so
--
--   .select('actor:profiles!audit_logs_actor_id_fkey(full_name)')
--
-- fails at RUN TIME while the key leads to auth.users. Typecheck passes,
-- because the generated types describe a relation to `users` and simply do not
-- know the embed is impossible. The audit-log viewer added in this change hit
-- exactly that.
--
-- Safe because profiles.id IS auth.users.id (profiles.id REFERENCES
-- auth.users(id) ON DELETE CASCADE, and handle_new_user creates a row for every
-- new auth user), so integrity to auth.users is preserved transitively.
--
-- ON DELETE behaviour is restated per constraint, taken from the live schema,
-- so none of it is silently downgraded to NO ACTION.
--
-- Deliberately NOT converted:
--   profiles.id                        — this IS the link to auth.users.
--   admin_users.user_id                — a platform admin is not a tenant
--   admin_impersonations.target_user_id  member and need not have a profile.
-- =============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- table,                     column,         constraint,                              on delete
      ('audit_logs',                'actor_id',     'audit_logs_actor_id_fkey',              'SET NULL'),
      ('approval_steps',            'decided_by',   'approval_steps_decided_by_fkey',        'SET NULL'),
      ('import_export_jobs',        'started_by',   'import_export_jobs_started_by_fkey',    'SET NULL'),
      ('integrations',              'connected_by', 'integrations_connected_by_fkey',        'SET NULL'),
      ('portal_project_access',     'granted_by',   'portal_project_access_granted_by_fkey', 'SET NULL'),
      ('webhook_endpoints',         'created_by',   'webhook_endpoints_created_by_fkey',     'SET NULL'),
      ('workflows',                 'created_by',   'workflows_created_by_fkey',             'SET NULL'),
      ('workspaces',                'created_by',   'workspaces_created_by_fkey',            'SET NULL'),
      ('portal_users',              'user_id',      'portal_users_user_id_fkey',             'SET NULL'),
      ('announcement_dismissals',   'user_id',      'announcement_dismissals_user_id_fkey',  'CASCADE'),
      ('notification_preferences',  'user_id',      'notification_preferences_user_id_fkey', 'CASCADE'),
      ('user_sessions',             'user_id',      'user_sessions_user_id_fkey',            'CASCADE')
    ) AS t(tbl, col, con, ondelete)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.con);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I)
         REFERENCES public.profiles(id) ON DELETE %s',
      r.tbl, r.con, r.col, r.ondelete);
  END LOOP;
END $$;

COMMENT ON CONSTRAINT audit_logs_actor_id_fkey ON audit_logs IS
  'Points at profiles rather than auth.users so PostgREST can embed the actor. profiles.id is auth.users.id.';

-- The customer-facing audit viewer filters on these and orders by time.
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
  ON audit_logs (organization_id, created_at DESC);
