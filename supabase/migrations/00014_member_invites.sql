-- Member invitations
--
-- Inviting a colleague has to answer one question RLS cannot: does this email
-- already have an account? `auth.users` is not reachable from the API schema,
-- and exposing it would hand every authenticated user an email-enumeration
-- oracle. This resolves the question in the database instead, and grants
-- execute to service_role ONLY — the invite action is the sole caller.

CREATE OR REPLACE FUNCTION public.user_id_for_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.user_id_for_email(text) IS
  'Resolves an email to an auth.users id. service_role only: callable by the invite flow, never by an end user.';

-- Fail closed: revoke from every default grantee before granting narrowly.
REVOKE ALL ON FUNCTION public.user_id_for_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_id_for_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.user_id_for_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.user_id_for_email(text) TO service_role;
