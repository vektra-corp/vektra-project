-- =============================================================================
-- 00011_profile_relationships
--
-- Repoint user-referencing foreign keys from auth.users to public.profiles.
--
-- WHY: PostgREST can only embed a related table when a foreign key connects the
-- two. Every column here pointed at auth.users, so a query like
--
--   .select('assignee:profiles!tasks_assignee_id_fkey(full_name, avatar_url)')
--
-- fails with "could not find the relation between tasks and profiles" — the FK
-- leads to auth.users, not profiles. Every board, list, report and task-detail
-- query in the app relies on exactly that embed.
--
-- This is safe because profiles.id IS auth.users.id: profiles has
-- `id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`, and
-- handle_new_user() creates a profile row for every new auth user. Referential
-- integrity to auth.users is preserved transitively, and deleting an auth user
-- still cascades to the profile and onward through these keys.
--
-- ON DELETE behaviour is restated per constraint so it is not silently lost.
-- =============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- table,               column,        constraint,                        on delete
      ('tasks',               'assignee_id', 'tasks_assignee_id_fkey',           'SET NULL'),
      ('tasks',               'assigner_id', 'tasks_assigner_id_fkey',           'SET NULL'),
      ('tasks',               'created_by',  'tasks_created_by_fkey',            'SET NULL'),
      ('subtasks',            'assignee_id', 'subtasks_assignee_id_fkey',        'SET NULL'),
      ('subtasks',            'created_by',  'subtasks_created_by_fkey',         'SET NULL'),
      ('comments',            'author_id',   'comments_author_id_fkey',          'CASCADE'),
      ('attachments',         'uploaded_by', 'attachments_uploaded_by_fkey',     'CASCADE'),
      ('documents',           'created_by',  'documents_created_by_fkey',        'SET NULL'),
      ('projects',            'created_by',  'projects_created_by_fkey',         'SET NULL'),
      ('org_members',         'user_id',     'org_members_user_id_fkey',         'CASCADE'),
      ('workspace_members',   'user_id',     'workspace_members_user_id_fkey',   'CASCADE'),
      ('project_members',     'user_id',     'project_members_user_id_fkey',     'CASCADE'),
      ('notifications',       'user_id',     'notifications_user_id_fkey',       'CASCADE')
    ) AS t(tbl, col, con, ondelete)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.con);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I)
         REFERENCES public.profiles(id) ON DELETE %s',
      r.tbl, r.con, r.col, r.ondelete);
  END LOOP;
END $$;

COMMENT ON CONSTRAINT tasks_assignee_id_fkey ON tasks IS
  'Points at profiles rather than auth.users so PostgREST can embed the assignee. profiles.id is auth.users.id.';
