-- Member email addresses, for the Members screen.
--
-- The members list shows each person's email. `profiles` does not carry one —
-- the address is Supabase's, in `auth.users` — and `auth.users` is not readable
-- by `authenticated`. The two ways to bridge that are the service role and a
-- SECURITY DEFINER function; §13.10 limits the service role to four places, and
-- a customer-facing page is not among them, so this is the function.
--
-- The tenant is taken from the JWT rather than from an argument. That is the
-- lesson of `increment_usage` (§6.8b): a SECURITY DEFINER function that accepts
-- the organization as a parameter lets any caller name any tenant. `org_id()`
-- cannot be spoofed by the caller, so this can only ever return the caller's own
-- organization.
--
-- The role gate matches the page: only manager and above can open Members, and
-- only manager and above can read the addresses. A member calling this directly
-- gets an empty set, not an error — it is a listing, and failing closed here
-- means returning nothing.

CREATE OR REPLACE FUNCTION public.org_member_emails()
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.user_id, u.email::text
  FROM org_members om
  JOIN auth.users u ON u.id = om.user_id
  WHERE om.organization_id = public.org_id()
    AND public.has_org_role('manager');
$$;

COMMENT ON FUNCTION public.org_member_emails() IS
  'Email addresses of the calling user''s own organization members. Manager+ only; '
  'tenant comes from the JWT, never from an argument.';

-- `ALTER DEFAULT PRIVILEGES` in 00009 grants EXECUTE on new functions broadly,
-- so the grant is stated explicitly and `anon` is revoked: an unauthenticated
-- caller has no org_id claim and would get an empty set anyway, but the
-- privilege should not depend on that.
REVOKE ALL ON FUNCTION public.org_member_emails() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_member_emails() TO authenticated;
