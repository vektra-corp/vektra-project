-- =============================================================================
-- 00031_drop_duplicate_job_policy
--
-- 00029 added an INSERT policy to `import_export_jobs` on the belief that the
-- table had none. It already had one — "Members start jobs", from 00009 — with
-- an identical WITH CHECK. The comment in 00029 saying "nobody could ever
-- record a job" is therefore wrong; what was actually missing was the
-- completion path, which is why finish_transfer_job was needed.
--
-- Two INSERT policies with the same check are OR'd and behave as one, so this
-- changes nothing at run time. It is worth removing anyway: a reader auditing
-- the policies on a table has to work out whether two similar-looking rules
-- differ, and "they are identical" is a conclusion nobody should have to reach
-- twice.
--
-- The original is kept and the duplicate dropped, so the policy stays where
-- someone reading 00009 would expect to find it.
-- =============================================================================

DROP POLICY IF EXISTS "Users record their own jobs" ON import_export_jobs;

COMMENT ON TABLE import_export_jobs IS
  'Import and export history. INSERT is policy-gated to the person doing it ("Members start jobs", 00009); completion goes through finish_transfer_job (00029). There is deliberately no UPDATE or DELETE policy — a job is a record of what happened.';
