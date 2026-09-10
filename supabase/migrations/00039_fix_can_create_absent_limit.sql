-- Fix: can_create() denied every metric that a plan's `limits` does not name.
--
-- 00037 guarded the "unlimited" case with:
--
--   IF jsonb_typeof(v_limits -> v_key) <> 'number' THEN RETURN true; END IF;
--
-- and its comment claimed that covered "absent or JSON null". It only covered
-- JSON null. For an ABSENT key `v_limits -> v_key` is SQL NULL, so
-- jsonb_typeof() is NULL, and `NULL <> 'number'` evaluates to NULL — not true.
-- plpgsql treats a NULL condition as false, so control fell through to the
-- comparison below, where `usage_actual(...) < NULL` returned NULL. The caller
-- (assertPlanLimit) fails closed on anything that is not exactly true, so the
-- action was rejected with "Plan limit reached".
--
-- No plan's limits jsonb names `tasks`, so this denied EVERY task creation on
-- every plan. Same for any other metric a plan does not describe.
--
-- `IS DISTINCT FROM` is NULL-safe and yields true for all three of: absent key,
-- JSON null, and a non-numeric value — which is what the original comment
-- intended. Behaviour for a numeric limit is unchanged.
CREATE OR REPLACE FUNCTION public.can_create(p_metric text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org    uuid := public.org_id();
  v_limits jsonb;
  v_limit  bigint;
  v_key    text := CASE p_metric
                     WHEN 'workflow_runs' THEN 'workflow_runs_per_month'
                     ELSE p_metric
                   END;
BEGIN
  IF v_org IS NULL THEN RETURN false; END IF;

  SELECT e.limits INTO v_limits FROM public.org_entitlements(v_org) e;
  IF v_limits IS NULL THEN RETURN false; END IF;

  -- Absent key, JSON null, or a non-number: the plan does not cap this metric.
  IF jsonb_typeof(v_limits -> v_key) IS DISTINCT FROM 'number' THEN
    RETURN true;
  END IF;

  v_limit := (v_limits ->> v_key)::bigint;
  RETURN public.usage_actual(v_org, p_metric) < v_limit;
END;
$$;

COMMENT ON FUNCTION public.can_create IS
  'Whether the caller''s organization may create one more of a metered thing. Authoritative: recounts rather than trusting usage_counters. A metric the plan does not name is uncapped.';

GRANT EXECUTE ON FUNCTION public.can_create(text) TO authenticated, service_role;
