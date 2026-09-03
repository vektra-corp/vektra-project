-- =============================================================================
-- 00013_auth_context_rpc
--
-- Resolve the caller's tenant context in a single round trip.
--
-- WHY: against a hosted database every query costs ~240ms of network, versus
-- ~1ms locally. getAuthContext() was making three sequential calls — getUser(),
-- an org_members lookup, then a custom-role lookup that almost always misses
-- because custom roles are Enterprise-only. That is ~720ms, paid again in
-- middleware, in the layout and in the page.
--
-- This collapses the two database calls into one, and returns NULL rather than
-- erroring when the user belongs to no organization, so callers can treat
-- "no context" as an ordinary case.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_auth_context(p_org_slug text DEFAULT NULL)
RETURNS TABLE (
  organization_id uuid,
  org_role        text,
  org_slug        text,
  org_timezone    text,
  org_currency    text,
  org_status      text,
  plan_name       text,
  permissions     jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    om.organization_id,
    om.role,
    o.slug,
    o.timezone,
    o.currency,
    o.status,
    p.name,
    -- Custom role overrides, if this org defines a role of the same name.
    -- Folded in here so it costs no extra round trip.
    r.permissions
  FROM org_members om
  JOIN organizations o ON o.id = om.organization_id
  LEFT JOIN plans p ON p.id = o.plan_id
  LEFT JOIN roles r
    ON r.organization_id = om.organization_id
   AND r.name = om.role
   AND NOT r.is_system
  WHERE om.user_id = auth.uid()
    AND (p_org_slug IS NULL OR o.slug = p_org_slug)
  ORDER BY om.is_default DESC, om.joined_at ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_auth_context IS
  'Tenant context for the current user in one round trip. SECURITY DEFINER so it reads org_members without depending on that table''s own SELECT policy.';

REVOKE EXECUTE ON FUNCTION public.current_auth_context(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_auth_context(text) TO authenticated;
