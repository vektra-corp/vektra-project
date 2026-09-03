-- =============================================================================
-- 00006_integrations
--
-- Connected third-party providers and customer-configured outbound webhooks.
-- claude.md §6.6, §12.
--
-- OAuth tokens are encrypted with pgcrypto BEFORE storage and decrypted only at
-- the moment of use in an Edge Function (§13.10). The key lives in Doppler and
-- is passed in per call — it is never stored in the database.
-- =============================================================================

CREATE TABLE integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider         text NOT NULL,     -- 'slack', 'teams', 'github', 'google', ...
  status           text NOT NULL DEFAULT 'connected'
                   CHECK (status IN ('connected', 'disconnected', 'error')),
  -- Ciphertext, not plaintext. See encrypt_secret/decrypt_secret below.
  access_token     bytea,
  refresh_token    bytea,
  token_expires_at timestamptz,
  config           jsonb NOT NULL DEFAULT '{}',   -- Channels, repos, provider settings
  last_error       text,
  connected_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

CREATE INDEX idx_integrations_org ON integrations(organization_id);
CREATE INDEX idx_integrations_active ON integrations(organization_id, provider)
  WHERE status = 'connected';

COMMENT ON COLUMN integrations.access_token IS
  'pgp_sym_encrypt ciphertext. Never selected by client-facing queries; RLS denies SELECT to authenticated (§13.10).';

-- Symmetric encryption helpers. The key is supplied by the caller (an Edge
-- Function reading it from Doppler), so a database dump alone reveals nothing.
CREATE OR REPLACE FUNCTION public.encrypt_secret(plaintext text, key text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT pgp_sym_encrypt(plaintext, key);
$$;

CREATE OR REPLACE FUNCTION public.decrypt_secret(ciphertext bytea, key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT pgp_sym_decrypt(ciphertext, key);
$$;

REVOKE EXECUTE ON FUNCTION public.encrypt_secret(text, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrypt_secret(bytea, text) FROM public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Outbound webhook endpoints
-- -----------------------------------------------------------------------------

CREATE TABLE webhook_endpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url             text NOT NULL CHECK (url ~ '^https://'),
  description     text,
  events          text[] NOT NULL CHECK (array_length(events, 1) > 0),
  secret          text NOT NULL,      -- HMAC signing secret for the receiver
  is_active       boolean NOT NULL DEFAULT true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   integer NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_endpoints_org ON webhook_endpoints(organization_id) WHERE is_active;
-- Lets the dispatcher find endpoints subscribed to a given event type.
CREATE INDEX idx_webhook_endpoints_events ON webhook_endpoints USING gin (events);

COMMENT ON COLUMN webhook_endpoints.url IS
  'HTTPS only. Plain HTTP delivery would leak payloads in transit.';

-- -----------------------------------------------------------------------------
-- Delivery attempts, so customers can debug their own integrations
-- -----------------------------------------------------------------------------

CREATE TABLE webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  status_code     integer,
  response_body   text,
  error           text,
  attempt         integer NOT NULL DEFAULT 1,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_deliveries_endpoint
  ON webhook_deliveries(endpoint_id, created_at DESC);
CREATE INDEX idx_webhook_deliveries_org ON webhook_deliveries(organization_id);

SELECT public.apply_updated_at_triggers();
