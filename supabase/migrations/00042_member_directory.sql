-- Member directory: email plus invitation state, for the Members screen.
--
-- `org_member_emails` (00038) answered "what is this person's address?". The
-- screen now also has to answer "have they actually joined yet?", and that
-- fact lives in the same unreachable place: `auth.users`. Rather than add a
-- second SECURITY DEFINER function over the same join, this supersedes it.
--
-- The tenant still comes from the JWT, never from an argument (§6.8b), and the
-- role gate still matches the page: manager and above. A member calling it
-- directly gets an empty set — it is a listing, and failing closed on a listing
-- means returning nothing.
--
-- Status is derived, not stored. There is no `invited` column to drift out of
-- sync with reality:
--   pending  — invited, never signed in. The invitation is outstanding.
--   active   — has signed in at least once.
-- `invited_at` is Supabase's own timestamp for an admin-generated invite, and is
-- surfaced so the screen can say how long an invitation has been waiting.

CREATE OR REPLACE FUNCTION public.org_member_directory()
RETURNS TABLE (
  user_id     uuid,
  email       text,
  status      text,
  invited_at  timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    om.user_id,
    u.email::text,
    CASE WHEN u.last_sign_in_at IS NULL THEN 'pending' ELSE 'active' END AS status,
    u.invited_at,
    u.last_sign_in_at
  FROM org_members om
  JOIN auth.users u ON u.id = om.user_id
  WHERE om.organization_id = public.org_id()
    AND public.has_org_role('manager');
$$;

COMMENT ON FUNCTION public.org_member_directory() IS
  'Email and invitation state for the calling user''s own organization members. '
  'Manager+ only; tenant comes from the JWT, never from an argument.';

-- 00009''s ALTER DEFAULT PRIVILEGES grants EXECUTE on new functions broadly, so
-- state the grant explicitly and revoke anon: an unauthenticated caller has no
-- org_id claim and would get an empty set anyway, but the privilege should not
-- depend on that.
REVOKE ALL ON FUNCTION public.org_member_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_member_directory() TO authenticated;
