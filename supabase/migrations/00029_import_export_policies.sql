-- =============================================================================
-- 00029_import_export_policies
--
-- `import_export_jobs` (00007) has a SELECT policy and nothing else, so nobody
-- could ever record a job. It has never been written to.
--
-- A job row is a record of what a person did — who exported what, when, and how
-- it went — so the person doing it inserts their own row rather than the write
-- being pushed to the service role. `started_by = auth.uid()` is what makes the
-- existing SELECT policy ("your own jobs, or admin") meaningful.
--
-- There is no UPDATE or DELETE policy, deliberately: like an audit entry, a job
-- is history. The import flow finishes a job through `finish_transfer_job`
-- below, which is the only way a row changes.
-- =============================================================================

CREATE POLICY "Users record their own jobs" ON import_export_jobs
  FOR INSERT WITH CHECK (
    organization_id = public.org_id()
    AND started_by = auth.uid()
  );

-- Completing a job is the one legitimate mutation, and it must not be a general
-- UPDATE grant — that would let someone rewrite another person's result, or
-- their own history. SECURITY DEFINER with an explicit owner check instead.
CREATE OR REPLACE FUNCTION public.finish_transfer_job(
  p_job    uuid,
  p_status text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'A job can only finish as completed or failed';
  END IF;

  UPDATE import_export_jobs
     SET status       = p_status,
         result       = p_result,
         completed_at = now()
   WHERE id = p_job
     AND organization_id = public.org_id()
     AND started_by = auth.uid()
     -- Finishing twice would overwrite the real result with a retry's.
     AND completed_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_transfer_job(uuid, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.finish_transfer_job(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.finish_transfer_job(uuid, text, jsonb) IS
  'Records the outcome of an import or export. Owner-scoped and single-shot; there is deliberately no general UPDATE policy on import_export_jobs.';
