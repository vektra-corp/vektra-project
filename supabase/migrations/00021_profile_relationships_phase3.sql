-- =============================================================================
-- 00021_profile_relationships_phase3
--
-- Repoint the user-referencing foreign keys added since 00011 from auth.users
-- to public.profiles, for the same reason and with the same safety argument.
--
-- WHY: PostgREST can only embed a related table when a foreign key connects the
-- two. A query like
--
--   .select('profile:profiles!employees_user_id_fkey(full_name)')
--
-- fails with "could not find the relation between employees and profiles" while
-- the key leads to auth.users. Every directory, timesheet and lead view relies
-- on exactly that embed, and the failure is at run time, not build time — the
-- generated types happily describe a relation to `users`.
--
-- Safe because profiles.id IS auth.users.id: profiles has
-- `id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`, and
-- handle_new_user() creates a profile for every new auth user. Referential
-- integrity to auth.users is preserved transitively.
--
-- ON DELETE behaviour is restated per constraint so it is not silently lost.
-- =============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- table,                  column,        constraint,                            on delete
      ('employees',              'user_id',     'employees_user_id_fkey',               'CASCADE'),
      ('leave_requests',         'approved_by', 'leave_requests_approved_by_fkey',      'SET NULL'),
      ('time_entries',           'user_id',     'time_entries_user_id_fkey',            'CASCADE'),
      ('timesheet_periods',      'user_id',     'timesheet_periods_user_id_fkey',       'CASCADE'),
      ('timesheet_periods',      'approved_by', 'timesheet_periods_approved_by_fkey',   'SET NULL'),
      ('leads',                  'assigned_to', 'leads_assigned_to_fkey',               'SET NULL'),
      ('leads',                  'created_by',  'leads_created_by_fkey',                'SET NULL'),
      ('lead_activities',        'created_by',  'lead_activities_created_by_fkey',      'SET NULL'),
      ('saved_reports',          'created_by',  'saved_reports_created_by_fkey',        'CASCADE'),
      ('auto_assignment_rules',  'created_by',  'auto_assignment_rules_created_by_fkey','SET NULL'),
      ('dashboard_configs',      'user_id',     'dashboard_configs_user_id_fkey',       'CASCADE'),
      -- Commercial and collaboration keys predate 00011 but were not in its list.
      ('commercial_documents',   'created_by',  'commercial_documents_created_by_fkey', 'SET NULL'),
      ('commercial_documents',   'approved_by', 'commercial_documents_approved_by_fkey','SET NULL'),
      ('contacts',               'created_by',  'contacts_created_by_fkey',             'SET NULL'),
      ('document_versions',      'edited_by',   'document_versions_edited_by_fkey',     'SET NULL'),
      ('portal_users',           'invited_by',  'portal_users_invited_by_fkey',         'SET NULL')
    ) AS t(tbl, col, con, ondelete)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.con);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I)
         REFERENCES public.profiles(id) ON DELETE %s',
      r.tbl, r.con, r.col, r.ondelete);
  END LOOP;
END $$;

COMMENT ON CONSTRAINT employees_user_id_fkey ON employees IS
  'Points at profiles rather than auth.users so PostgREST can embed the person. profiles.id is auth.users.id.';
