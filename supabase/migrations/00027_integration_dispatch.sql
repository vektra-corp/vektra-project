-- =============================================================================
-- 00027_integration_dispatch
--
-- Everything the §12 integration dispatcher needs that the schema did not
-- already have.
--
-- 1. Token access. 00006 stores integration OAuth tokens as pgcrypto
--    ciphertext and revokes encrypt_secret/decrypt_secret from end-user roles,
--    which is right — but left no way for the app to save or read one without
--    doing the encryption in two round trips and passing ciphertext through
--    PostgREST as a hex string. Two SECURITY DEFINER functions close that.
--
-- 2. A dispatch cursor. `events.processed` exists and is indexed for exactly
--    this, and the workflow dispatcher deliberately does not touch it (see
--    00024) so that this consumer can own it.
--
-- 3. Somewhere to record what happened to a delivery, so a customer can see
--    that their Slack integration has been failing rather than quietly
--    wondering why the channel is silent.
-- =============================================================================

-- --- 1. token access ---------------------------------------------------------

-- The key is passed in rather than read from a setting: Supabase does not give
-- us a safe place to keep one inside the database, and a key stored beside the
-- ciphertext protects nothing. It lives in Doppler and reaches here as an
-- argument from a service-role caller (§13.10).
-- search_path includes `extensions` because that is where Supabase installs
-- pgcrypto. Pinning it to `public` alone — the usual SECURITY DEFINER hygiene —
-- makes pgp_sym_encrypt unresolvable and the function fails at call time, not
-- at creation. It is still pinned, which is the part that matters: a definer
-- function must not inherit the caller's search_path.
CREATE OR REPLACE FUNCTION public.save_integration(
  p_org           uuid,
  p_provider      text,
  p_access_token  text,
  p_config        jsonb,
  p_key           text,
  p_connected_by  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO integrations (organization_id, provider, access_token, config, status, connected_by, last_error)
  VALUES (
    p_org,
    p_provider,
    public.encrypt_secret(p_access_token, p_key),
    COALESCE(p_config, '{}'::jsonb),
    'connected',
    p_connected_by,
    NULL
  )
  ON CONFLICT (organization_id, provider) DO UPDATE
    SET access_token = EXCLUDED.access_token,
        config       = EXCLUDED.config,
        status       = 'connected',
        connected_by = EXCLUDED.connected_by,
        last_error   = NULL,
        updated_at   = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Reading a token is the sensitive half: it returns a live credential for a
-- third-party workspace. Only the dispatcher, which runs as service_role, has
-- any business calling it.
CREATE OR REPLACE FUNCTION public.integration_access_token(p_integration uuid, p_key text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT public.decrypt_secret(access_token, p_key)
  FROM integrations
  WHERE id = p_integration AND access_token IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.save_integration(uuid, text, text, jsonb, text, uuid)
  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integration_access_token(uuid, text)
  FROM public, anon, authenticated;

COMMENT ON FUNCTION public.integration_access_token(uuid, text) IS
  'Returns a live third-party credential. service_role only — never expose through PostgREST to an end user.';

-- --- 2. dispatch cursor ------------------------------------------------------

-- The dispatcher claims a batch, delivers it, then marks it processed. Ordering
-- by created_at within the unprocessed set is what the existing
-- idx_events_unprocessed cannot serve on its own.
CREATE INDEX IF NOT EXISTS idx_events_unprocessed_ordered
  ON events (created_at)
  WHERE processed = false;

-- --- 3. delivery bookkeeping -------------------------------------------------

CREATE TABLE integration_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id  uuid REFERENCES integrations(id) ON DELETE CASCADE,
  webhook_id      uuid REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE SET NULL,
  event_type      text NOT NULL,
  status          text NOT NULL CHECK (status IN ('delivered', 'failed', 'skipped')),
  detail          text,
  duration_ms     integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- A delivery belongs to exactly one destination. Without this a row could
  -- name both, or neither, and the history would not add up.
  CHECK (
    (integration_id IS NOT NULL AND webhook_id IS NULL)
    OR (integration_id IS NULL AND webhook_id IS NOT NULL)
  )
);

CREATE INDEX idx_integration_deliveries_org
  ON integration_deliveries (organization_id, created_at DESC);

-- One delivery per destination per event, so a retried batch cannot post the
-- same message to a channel twice. Partial, because either column may be NULL.
CREATE UNIQUE INDEX idx_integration_deliveries_once
  ON integration_deliveries (COALESCE(integration_id, webhook_id), event_id)
  WHERE event_id IS NOT NULL;

ALTER TABLE integration_deliveries ENABLE ROW LEVEL SECURITY;

-- Admins can see whether delivery is working. Nobody writes through PostgREST:
-- the dispatcher runs as service_role, which bypasses RLS entirely.
CREATE POLICY "Admins read integration deliveries" ON integration_deliveries
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('admin'));
