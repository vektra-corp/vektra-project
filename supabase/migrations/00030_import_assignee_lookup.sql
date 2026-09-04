-- =============================================================================
-- 00030_import_assignee_lookup
--
-- A CSV import names assignees by email, and there is currently no safe way to
-- resolve one from application code.
--
--   * `profiles` has no email column — emails live in `auth.users`, which
--     PostgREST cannot reach. An embed that selects `profiles(email)` therefore
--     resolves to nothing, silently, and every imported row comes out
--     unassigned with no error. (That is exactly what happened while building
--     this; a cast hid it from the type checker.)
--   * `user_id_for_email` (00014) does reach auth.users, but resolves ANY email
--     across the whole platform and is service_role only for that reason — it
--     is an account-enumeration oracle.
--
-- This is the narrow version: it answers "which of these emails belong to
-- members of MY organisation", and nothing else. That is not a disclosure —
-- the members page already lists exactly those people. An email that is not a
-- member of the caller's org returns no row, whether or not an account exists,
-- so it cannot be used to probe for accounts.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.org_member_ids_for_emails(p_emails text[])
RETURNS TABLE (email text, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT lower(u.email)::text, u.id
  FROM auth.users u
  JOIN public.org_members m
    ON m.user_id = u.id
   AND m.organization_id = public.org_id()
  WHERE lower(u.email) = ANY (
          SELECT lower(trim(e)) FROM unnest(p_emails) AS e
        )
    -- Bulk resolution belongs to the import flow, which is manager-gated.
    AND public.has_org_role('manager')
  -- A caller cannot turn this into an unbounded scan of auth.users.
  LIMIT 500;
$$;

COMMENT ON FUNCTION public.org_member_ids_for_emails(text[]) IS
  'Resolves emails to user ids, restricted to members of the caller''s own organisation. Safe for end users because it discloses only what the members page already shows; contrast user_id_for_email, which spans the platform and is service_role only.';

REVOKE ALL ON FUNCTION public.org_member_ids_for_emails(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_member_ids_for_emails(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_member_ids_for_emails(text[]) TO authenticated;
