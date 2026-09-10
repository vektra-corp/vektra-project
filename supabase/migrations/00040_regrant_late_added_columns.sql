-- Fix: columns added after 00009 never received the column-scoped UPDATE grant.
--
-- 00009 protects a few identity/derived columns by withholding the TABLE-level
-- UPDATE privilege and instead granting every *other* column explicitly, via
-- grant_columns_except(). That enumerates information_schema.columns at the
-- moment it runs, so it only ever covered the columns that existed in 00009.
--
-- Every column added to `projects` or `tasks` by a later migration therefore
-- has no UPDATE grant at all. Because the table-level privilege is withheld,
-- touching one of them fails the whole statement with
-- "permission denied for table <t>" — even when RLS would have allowed the row.
--
-- Two real regressions came from this:
--
--   * projects.key   — the project settings form submits `key` on every save,
--                      so EVERY project settings save failed. Key edits are
--                      intended: createProject derives a key from the name and
--                      updateProject already handles the unique violation.
--   * tasks.sprint_id — planning/actions.ts assigns a task to a sprint with
--                      `update({ sprint_id })`, which always failed.
--
-- Re-running grant_columns_except() re-enumerates the current columns and
-- restores the intended shape. The except-lists below are the union of what
-- 00009 withheld and the identity columns added since, so the protections that
-- were deliberate stay in place:
--
--   projects.last_task_number — the counter behind task numbers (00009)
--   projects.public_id        — generated external id, immutable (00034)
--   tasks.task_number         — business rule 1: assigned by trigger (00009)
--   tasks.public_id           — generated external id, immutable (00034)
--
-- Note for future migrations: adding a column to either table means re-running
-- the matching grant below, otherwise the new column silently becomes
-- unwritable by `authenticated`.
DO $$
BEGIN
  PERFORM public.grant_columns_except(
    'projects', 'UPDATE', ARRAY['last_task_number', 'public_id'], 'authenticated');

  PERFORM public.grant_columns_except(
    'tasks', 'UPDATE', ARRAY['task_number', 'public_id'], 'authenticated');
END $$;
