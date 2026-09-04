-- =============================================================================
-- 00022_revoke_revenue_summary
--
-- SECURITY FIX: revoke direct access to the revenue_summary materialized view.
--
-- A materialized view cannot carry row-level security. Supabase's default
-- privileges on the `public` schema grant SELECT to `anon` and `authenticated`
-- on every new relation, so 00020 silently created a view any signed-in user
-- could read in full — every tenant's invoiced revenue, outstanding balance and
-- quotation pipeline, cross-organization.
--
-- `revenue_for_org()` was always the intended entry point: it is
-- SECURITY INVOKER and filters on public.org_id(), so a caller only ever sees
-- their own tenant. This makes it the ONLY entry point.
--
-- Verified before the fix, as an Acme member:
--   SELECT organization_id, invoiced_revenue FROM revenue_summary;
--   -> aaaaaaaa 1000.00
--   -> bbbbbbbb 7777.00   <-- another tenant
-- =============================================================================

REVOKE ALL ON revenue_summary FROM PUBLIC;
REVOKE ALL ON revenue_summary FROM anon;
REVOKE ALL ON revenue_summary FROM authenticated;

-- The rollup is refreshed by a background job and read through the function,
-- both of which run as service_role.
GRANT SELECT ON revenue_summary TO service_role;

COMMENT ON MATERIALIZED VIEW revenue_summary IS
  'Revenue rollup. NOT directly readable: a materialized view cannot carry RLS. Read it through revenue_for_org(), which filters to the caller''s organization. Refreshed by refresh_revenue_summary() from the background job.';

-- The function is SECURITY INVOKER, so it runs with the caller's privileges and
-- would now be blocked by the revoke above. Make it DEFINER so it can read the
-- view, and keep the org filter as the boundary — the filter is what makes this
-- safe, not the caller's grants.
CREATE OR REPLACE FUNCTION public.revenue_for_org(p_months integer DEFAULT 12)
RETURNS TABLE (
  month date,
  currency text,
  invoiced_revenue numeric,
  outstanding_invoices numeric,
  overdue_invoices numeric,
  pipeline_quotations numeric,
  accepted_quotations numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.month, r.currency, r.invoiced_revenue, r.outstanding_invoices,
         r.overdue_invoices, r.pipeline_quotations, r.accepted_quotations
  FROM revenue_summary r
  -- The whole boundary. org_id() reads the JWT claim, so a caller cannot ask
  -- about an organization they are not in, and is NULL for a portal user —
  -- which matches no rows.
  WHERE r.organization_id = public.org_id()
    AND r.month >= date_trunc('month', CURRENT_DATE)::date
                   - (GREATEST(p_months, 1) || ' months')::interval
  ORDER BY r.month DESC;
$$;

REVOKE ALL ON FUNCTION public.revenue_for_org(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revenue_for_org(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.revenue_for_org(integer) TO authenticated;
