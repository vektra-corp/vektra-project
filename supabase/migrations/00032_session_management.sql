-- =============================================================================
-- 00032_session_management
--
-- §13.6: people can see their active sessions and revoke them; an admin can
-- force-revoke for a member of their organisation.
--
-- `user_sessions` has existed since 00001 with SELECT and UPDATE policies, and
-- nothing has ever written to it. Two things were missing to make it real:
--
-- 1. An INSERT policy. A person records their own session at sign-in.
--
-- 2. A way for revocation to actually revoke. Marking `revoked_at` on our own
--    table would be security theatre — the refresh token in the browser would
--    keep working and the person would believe they had locked someone out.
--    Real revocation means deleting GoTrue's own session row, which is what
--    invalidates the refresh token.
--
--    That is possible because the access token carries a `session_id` claim, so
--    our row can be linked to the GoTrue session it describes. Without that
--    link there is no per-device revocation, only "sign out everywhere".
-- =============================================================================

ALTER TABLE user_sessions
  ADD COLUMN session_id uuid UNIQUE;

COMMENT ON COLUMN user_sessions.session_id IS
  'The auth.sessions row this describes, taken from the JWT session_id claim. Deleting that row is what actually revokes access; without this link, revoking would only be cosmetic.';

CREATE POLICY "Users record their own sessions" ON user_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- --- revocation ---------------------------------------------------------------

-- SECURITY DEFINER because it writes to the auth schema, which no end-user role
-- can reach. The authorisation is therefore done here, explicitly: you may
-- revoke your own session, or one belonging to a member of an organisation you
-- administer.
CREATE OR REPLACE FUNCTION public.revoke_user_session(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row user_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM user_sessions WHERE id = p_id;
  IF v_row.id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    v_row.user_id = auth.uid()
    OR (v_row.organization_id = public.org_id() AND public.has_org_role('admin'))
  ) THEN
    RETURN false;
  END IF;

  -- The part that matters. Deleting the GoTrue session invalidates its refresh
  -- token, so the browser holding it cannot mint a new access token.
  IF v_row.session_id IS NOT NULL THEN
    DELETE FROM auth.sessions WHERE id = v_row.session_id;
  END IF;

  UPDATE user_sessions SET revoked_at = now() WHERE id = p_id;
  RETURN true;
END;
$$;

-- Everything except the one being used right now. Used after a password change
-- (§13.6) and by the "sign out everywhere else" control.
CREATE OR REPLACE FUNCTION public.revoke_other_sessions(p_keep uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM auth.sessions
   WHERE user_id = auth.uid()
     AND (p_keep IS NULL OR id <> p_keep);

  UPDATE user_sessions
     SET revoked_at = now()
   WHERE user_id = auth.uid()
     AND revoked_at IS NULL
     AND (p_keep IS NULL OR session_id IS DISTINCT FROM p_keep);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_other_sessions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_user_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_other_sessions(uuid) TO authenticated;

-- --- housekeeping -------------------------------------------------------------

-- A session row whose GoTrue session no longer exists is stale: the person
-- signed out, or the refresh token expired. Marking those keeps the list
-- honest rather than showing devices that cannot actually get back in.
CREATE OR REPLACE FUNCTION public.prune_stale_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE user_sessions u
     SET revoked_at = now()
   WHERE u.user_id = auth.uid()
     AND u.revoked_at IS NULL
     AND u.session_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = u.session_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_stale_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_stale_sessions() TO authenticated;
