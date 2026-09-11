-- Invitation state, told from whether setup actually FINISHED.
--
-- 00042 derived `status` from `last_sign_in_at`, on the assumption that a
-- successful sign-in means the invitation was accepted. A broken accept flow
-- disproved it: Supabase's verify endpoint sets `last_sign_in_at` and
-- `confirmed_at` the moment the emailed token is consumed, BEFORE the person
-- reaches the screen where they choose a password. Interrupted there — a failed
-- redirect, a closed tab — the row reads "active" while the account has no
-- password and no way in, and the Members screen shows a colleague who has
-- joined when in fact they are stuck.
--
-- The honest question is "can this person sign in again tomorrow?", which means
-- do they hold a credential:
--   * a password, or
--   * a federated identity (Google, GitHub) that signs them in without one.
--
-- Someone holding neither has an unfinished invitation whatever their
-- timestamps say, and the screen should offer to resend it.

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
    CASE
      WHEN u.last_sign_in_at IS NULL THEN 'pending'
      -- Confirmed by a link but holding no credential: setup was interrupted.
      WHEN COALESCE(u.encrypted_password, '') = ''
       AND NOT EXISTS (
         SELECT 1 FROM auth.identities i
         WHERE i.user_id = u.id AND i.provider <> 'email'
       )
      THEN 'pending'
      ELSE 'active'
    END AS status,
    u.invited_at,
    u.last_sign_in_at
  FROM org_members om
  JOIN auth.users u ON u.id = om.user_id
  WHERE om.organization_id = public.org_id()
    AND public.has_org_role('manager');
$$;

COMMENT ON FUNCTION public.org_member_directory() IS
  'Email and invitation state for the calling user''s own organization members. '
  'Pending means "cannot sign in unaided": never signed in, or confirmed but holding '
  'neither a password nor a federated identity. Manager+ only; tenant comes from the JWT.';

REVOKE ALL ON FUNCTION public.org_member_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_member_directory() TO authenticated;

-- The same question, asked during an invite, before there is a membership row
-- to read through `org_member_directory`.
--
-- Service-role only, like `user_id_for_email` (00014) and for the same reason:
-- answering "does this address hold a credential?" for arbitrary input is an
-- account-enumeration oracle, and no end user has business calling it.
CREATE OR REPLACE FUNCTION public.user_needs_password(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.last_sign_in_at IS NULL
    OR (
      COALESCE(u.encrypted_password, '') = ''
      AND NOT EXISTS (
        SELECT 1 FROM auth.identities i
        WHERE i.user_id = u.id AND i.provider <> 'email'
      )
    )
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.user_needs_password(text) IS
  'True when the address has no usable credential and an invite link should be minted. service_role only.';

REVOKE ALL ON FUNCTION public.user_needs_password(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_needs_password(text) FROM anon;
REVOKE ALL ON FUNCTION public.user_needs_password(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.user_needs_password(text) TO service_role;
