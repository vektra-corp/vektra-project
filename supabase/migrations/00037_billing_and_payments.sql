-- =============================================================================
-- 00037_billing_and_payments
--
-- The product could not take money. Stripe was wired end to end — a checkout
-- action, a signature-verifying webhook, customer and subscription columns on
-- `organizations` — but nothing ever populated `plans.stripe_price_id_monthly`,
-- so every upgrade button rendered disabled and `startCheckout` threw before it
-- reached Stripe. It was also the wrong gateway: the primary market is India.
--
-- This replaces it with Razorpay (India) and PayPal (elsewhere), and closes two
-- live privilege-escalation holes found while building it. Those come first,
-- because they are the reason the rest of this file can be trusted.
--
-- HOLE 1 — a tenant could upgrade themselves for free.
--   00009 grants `authenticated` full DML on every table, and the
--   "Owners can update their organization" policy checks only WHICH ROW an
--   owner may write, never WHICH COLUMNS. RLS cannot express a column. So an
--   owner could send, with nothing but their own anon key:
--       PATCH /rest/v1/organizations?id=eq.<their org>
--       { "plan_id": "<enterprise>", "status": "active",
--         "trial_ends_at": "2099-01-01" }
--   and the enterprise plan id is readable by anon, because the pricing page
--   needs the catalogue. That is the entire "upgrade without paying" attack and
--   it worked. Closed below with grant_columns_except(), the same tool 00009
--   already used to protect commercial document totals.
--
-- HOLE 2 — a tenant could erase their own usage, or exhaust someone else's.
--   `increment_usage(org uuid, metric, delta)` is SECURITY DEFINER, takes the
--   organization as an ARGUMENT, and was granted to `authenticated` by the
--   blanket GRANT EXECUTE ON ALL FUNCTIONS in 00009. Any signed-in user could
--   call it with a negative delta to zero their own counters, or with another
--   tenant's uuid and a huge delta to push that tenant into their plan cap.
--   Closed below: the org now comes from the JWT and cannot be chosen.
--
-- The organising principle for everything new here is that ENTITLEMENT IS NEVER
-- DERIVABLE FROM A COLUMN A TENANT CAN WRITE. No end-user session holds INSERT,
-- UPDATE or DELETE on any billing table; every write comes from the service
-- role, in a signature-verified webhook or a background job.
--
-- Money is bigint MINOR UNITS, never numeric. The commercial module uses
-- numeric(12,2) because those are human-entered figures reconciled by eye;
-- these are machine figures reconciled against a gateway to the paisa, and a
-- numeric round trip through PostgREST and JSON is one more place for them to
-- disagree. Every amount column carries its currency beside it, because a
-- bigint with no currency is not an amount.
--
-- Deliberately NOT modelled: coupons (both gateways own that concept, and
-- mirroring it would give us a second discount engine to keep in sync), a
-- stored "amount currently due" (derived from price x seats, and would drift
-- the moment either changed), and proration (seat changes take effect at the
-- next renewal by design, so there is no mid-cycle credit to represent).
--
-- Backward-compatible per §15. The Stripe columns are NOT dropped here: this
-- migration and its code stop reading them, and a later migration removes them
-- once no deployed build references them.
-- =============================================================================


-- =============================================================================
-- SECURITY FIX 1: organizations column privileges
-- =============================================================================
--
-- Added before the new columns so the revoke below can cover them in one pass.

ALTER TABLE organizations
  ADD COLUMN billing_country  text
    CHECK (billing_country IS NULL OR billing_country ~ '^[A-Z]{2}$'),
  ADD COLUMN billing_state    text,
  ADD COLUMN gstin            text,
  ADD COLUMN payment_provider text
    CHECK (payment_provider IS NULL OR payment_provider IN ('razorpay', 'paypal'));

COMMENT ON COLUMN organizations.billing_country IS
  'ISO 3166-1 alpha-2. Decides the gateway (IN -> Razorpay, else PayPal) and the tax regime, so it is not tenant-writable: see set_billing_profile().';
COMMENT ON COLUMN organizations.billing_state IS
  'Indian GST state code. Place of supply, and what decides CGST+SGST versus IGST.';
COMMENT ON COLUMN organizations.payment_provider IS
  'Resolved gateway, recorded once a subscription exists. Derived from billing_country, never chosen by the customer.';

-- An Indian buyer's GSTIN goes onto a statutory document, so a malformed one is
-- a filing problem rather than a cosmetic one. Checked at the column.
ALTER TABLE organizations ADD CONSTRAINT organizations_gstin_shape CHECK (
  gstin IS NULL
  OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$'
);

-- "GSTIN says Karnataka, state code says Tamil Nadu" is precisely the input that
-- flips CGST+SGST into IGST. Make it unrepresentable rather than validated.
ALTER TABLE organizations ADD CONSTRAINT organizations_gstin_state_agrees CHECK (
  gstin IS NULL OR billing_state IS NULL OR left(gstin, 2) = billing_state
);

DO $$
BEGIN
  -- The columns an owner must not write. plan_id, status and trial_ends_at are
  -- entitlement; the billing_* columns choose the gateway and the tax regime,
  -- so a tenant who could set billing_country = 'US' would route themselves to
  -- PayPal and a zero-rated export invoice. Everything else on the table —
  -- name, logo, address, billing_email, gstin, currency, timezone, settings —
  -- stays writable, because the settings page legitimately edits it.
  PERFORM public.grant_columns_except(
    'organizations', 'UPDATE',
    ARRAY['plan_id', 'status', 'trial_ends_at',
          'billing_country', 'billing_state', 'payment_provider',
          'stripe_customer_id', 'stripe_subscription_id'],
    'authenticated');
END $$;

-- The legitimate way in. Owner-only, and it refuses to move the country once a
-- live subscription exists, because that would change both the gateway holding
-- the mandate and the tax treatment of an in-flight billing relationship.
CREATE OR REPLACE FUNCTION public.set_billing_profile(
  p_country text,
  p_state   text DEFAULT NULL,
  p_gstin   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.org_id();
  v_existing text;
  v_live boolean;
BEGIN
  IF v_org IS NULL OR NOT public.has_org_role('owner') THEN
    RAISE EXCEPTION 'Only an owner can change billing details'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'billing country must be a 2-letter ISO code';
  END IF;

  SELECT billing_country INTO v_existing FROM organizations WHERE id = v_org;

  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE organization_id = v_org
      AND status IN ('pending', 'active', 'past_due')
  ) INTO v_live;

  IF v_live AND v_existing IS DISTINCT FROM p_country THEN
    RAISE EXCEPTION 'Billing country cannot change while a subscription is live';
  END IF;

  UPDATE organizations
     SET billing_country = p_country,
         billing_state   = p_state,
         gstin           = p_gstin
   WHERE id = v_org;
END;
$$;

COMMENT ON FUNCTION public.set_billing_profile IS
  'The only tenant path to billing_country/billing_state. Owner-only, and frozen once a subscription is live.';

REVOKE ALL ON FUNCTION public.set_billing_profile(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_billing_profile(text, text, text) TO authenticated;


-- =============================================================================
-- SECURITY FIX 2: increment_usage is no longer aimable
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_usage_self(
  p_metric text,
  p_delta  bigint DEFAULT 1
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.org_id();
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No tenant context' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public.increment_usage(v_org, p_metric, p_delta);
END;
$$;

COMMENT ON FUNCTION public.increment_usage_self IS
  'Counter increment for the CALLER''S own organization, taken from the JWT. Replaces direct increment_usage() access, which let any user name any tenant.';

REVOKE ALL ON FUNCTION public.increment_usage(uuid, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage(uuid, text, bigint) TO service_role;

REVOKE ALL ON FUNCTION public.increment_usage_self(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_usage_self(text, bigint)
  TO authenticated, service_role;


-- =============================================================================
-- Plans: per-organization custom plans
-- =============================================================================
--
-- A custom plan is an ordinary plan row that names an owner. Catalogue plans
-- (organization_id IS NULL) stay readable by anon for the signed-out pricing
-- page; a custom plan is visible only to the tenant it belongs to.
--
-- `tier` is added because several places need the stable family a plan belongs
-- to — "downgrade to Starter", and the fallback when a custom plan omits a
-- limit key — and `name` can no longer answer that once an operator is free to
-- call a plan whatever they like.

ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_name_check;

ALTER TABLE plans
  ADD COLUMN tier                text NOT NULL DEFAULT 'starter'
    CHECK (tier IN ('starter', 'growth', 'enterprise')),
  ADD COLUMN organization_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN description         text,
  ADD COLUMN public_id           bigint NOT NULL DEFAULT public.new_public_id(),
  ADD COLUMN created_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at          timestamptz NOT NULL DEFAULT now();

UPDATE plans SET tier = name WHERE name IN ('starter', 'growth', 'enterprise');

ALTER TABLE plans ADD CONSTRAINT plans_public_id_16_digits
  CHECK (public_id BETWEEN 1000000000000000 AND 8999999999999999);

CREATE UNIQUE INDEX plans_public_id_key ON plans(public_id);
CREATE INDEX idx_plans_org ON plans(organization_id) WHERE organization_id IS NOT NULL;

COMMENT ON COLUMN plans.organization_id IS
  'NULL for the public catalogue. Set for an operator-created custom plan, which only that tenant can see.';
COMMENT ON COLUMN plans.tier IS
  'The plan family. Survives custom naming, and is what "downgrade to Starter" and the missing-key fallback read.';
COMMENT ON COLUMN plans.limits IS
  'Numeric ceilings. Source of truth over the TypeScript defaults, mirrored into usage_counters by apply_plan_limits().';
COMMENT ON COLUMN plans.features IS
  'Boolean capability gates. Source of truth over the TypeScript defaults, so a custom plan gates correctly.';


-- =============================================================================
-- Plan prices
-- =============================================================================
--
-- TAX-EXCLUSIVE, per seat. GST is added when the gateway plan is created,
-- because the gateway charges one inclusive figure and the invoice decomposes
-- it afterwards. Storing the inclusive amount would make the invoice's own
-- taxable line unreconstructable without re-deriving a rate.

CREATE TABLE plan_prices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  currency          text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billing_interval  text NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),
  unit_amount_minor bigint NOT NULL CHECK (unit_amount_minor >= 0),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, currency, billing_interval)
);

CREATE INDEX idx_plan_prices_plan ON plan_prices(plan_id) WHERE is_active;

COMMENT ON TABLE plan_prices IS
  'Per-seat, tax-exclusive price in integer minor units. One row per plan/currency/interval.';


-- =============================================================================
-- Gateway plan references
-- =============================================================================
--
-- Both gateways treat a plan's amount as immutable, so changing a price means
-- creating a new plan on their side. These rows are created on demand and
-- cached; the five-column UNIQUE is the idempotency key, so two concurrent
-- checkouts at the same amount collide here rather than creating two gateway
-- plans.
--
-- `amount_minor` is what the gateway plan was ACTUALLY created at, tax
-- included. The webhook compares a capture against this rather than recomputing
-- from plan_prices, so a price change made after a subscription started cannot
-- retroactively make an in-flight payment look wrong.

CREATE TABLE provider_plan_refs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_price_id       uuid NOT NULL REFERENCES plan_prices(id) ON DELETE CASCADE,
  provider            text NOT NULL CHECK (provider IN ('razorpay', 'paypal')),
  provider_plan_id    text NOT NULL,
  provider_product_id text,
  amount_minor        bigint NOT NULL CHECK (amount_minor >= 0),
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_price_id, provider, amount_minor),
  UNIQUE (provider, provider_plan_id)
);

COMMENT ON TABLE provider_plan_refs IS
  'Gateway-side plan objects, created on demand. amount_minor is the tax-inclusive figure the gateway actually charges.';


-- =============================================================================
-- Subscriptions — the entitlement authority
-- =============================================================================
--
-- History is kept: a row is never deleted when a subscription ends, so the
-- ledger can still say what a past payment was for.
--
-- `unit_amount_minor` and `seats` are snapshots of what this subscription was
-- created at, not a live join. A price change must not silently rewrite what an
-- existing customer agreed to.

CREATE TABLE subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                bigint NOT NULL DEFAULT public.new_public_id(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                  uuid NOT NULL REFERENCES plans(id),
  plan_price_id            uuid REFERENCES plan_prices(id),
  provider_plan_ref_id     uuid REFERENCES provider_plan_refs(id),

  -- How this came to exist. 'paid' is the only value a customer action can
  -- produce; the rest are operator grants, so a comped upgrade and real revenue
  -- are never confused in reporting or in an audit.
  grant_kind               text NOT NULL DEFAULT 'paid'
                           CHECK (grant_kind IN ('paid', 'trial', 'early_access', 'comp')),
  granted_by_admin_id      uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  grant_reason             text,
  grant_ends_at            timestamptz,

  provider                 text NOT NULL CHECK (provider IN ('razorpay', 'paypal', 'manual')),
  provider_subscription_id text,
  provider_customer_id     text,

  status                   text NOT NULL DEFAULT 'pending'
                           CHECK (status IN (
                             'pending',       -- created here, not yet authorised at the gateway
                             'authenticated', -- mandate registered, first debit not settled
                             'active',
                             'past_due',      -- a debit failed, retries in flight
                             'paused',
                             'cancelled',
                             'expired',       -- ran to term
                             'lapsed'         -- retries exhausted -> falls back to Starter
                           )),

  currency                 text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billing_interval         text NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),
  unit_amount_minor        bigint NOT NULL CHECK (unit_amount_minor >= 0),
  seats                    integer NOT NULL DEFAULT 1 CHECK (seats >= 1),

  trial_ends_at            timestamptz,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  cancelled_at             timestamptz,
  ended_at                 timestamptz,

  -- A scheduled change: an operator override or a seat recount. The gateway
  -- keeps charging the old amount until the sync job pushes this, so the
  -- customer's existing mandate keeps working.
  pending_plan_id          uuid REFERENCES plans(id),
  pending_price_id         uuid REFERENCES plan_prices(id),
  pending_seats            integer CHECK (pending_seats IS NULL OR pending_seats >= 1),
  pending_reason           text,
  pending_set_by_admin_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  pending_synced_at        timestamptz,

  -- PayPal refuses a revise that raises the amount above what the payer
  -- approved, and an Indian e-mandate has a registered debit ceiling. Both land
  -- here: the OLD price stays in force and the owner is asked to re-approve. A
  -- failed revise must never cause a lapse.
  needs_reauthorization    boolean NOT NULL DEFAULT false,
  reauthorization_url      text,

  -- Out-of-order webhook guard. A transition applies only when the provider's
  -- own event timestamp is at least this, so a delayed 'activated' cannot
  -- overwrite a newer 'halted'.
  provider_state_at        timestamptz,

  -- Opaque handle the post-checkout page polls with, stored as SHA-256 (the
  -- workflow-token posture from 00025). The token alone grants nothing: the
  -- status route also requires a session in the matching organization.
  checkout_token_hash      text,
  checkout_expires_at      timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_public_id_16_digits
    CHECK (public_id BETWEEN 1000000000000000 AND 8999999999999999),
  -- A grant is what makes 'manual' legitimate; without one it would be an
  -- untraceable free upgrade.
  CONSTRAINT subscriptions_manual_is_a_grant
    CHECK ((provider = 'manual') = (grant_kind IN ('trial', 'early_access', 'comp'))),
  -- A grant that never ends is a plan change, not a grant.
  CONSTRAINT subscriptions_grant_has_end
    CHECK (grant_kind NOT IN ('early_access', 'comp') OR grant_ends_at IS NOT NULL),
  -- Anything the gateway owns must carry its identifier once it leaves 'pending'.
  CONSTRAINT subscriptions_gateway_has_ref
    CHECK (provider = 'manual' OR status = 'pending' OR provider_subscription_id IS NOT NULL)
);

CREATE UNIQUE INDEX subscriptions_public_id_key ON subscriptions(public_id);
CREATE UNIQUE INDEX subscriptions_provider_ref_key
  ON subscriptions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- At most one LIVE subscription per tenant. This is what makes double-charging
-- structurally impossible: a second checkout while one is in flight is a unique
-- violation, not a race the application has to win.
CREATE UNIQUE INDEX subscriptions_one_live_per_org
  ON subscriptions(organization_id)
  WHERE status IN ('pending', 'authenticated', 'active', 'past_due', 'paused');

CREATE INDEX idx_subscriptions_org ON subscriptions(organization_id, status);
CREATE INDEX idx_subscriptions_period_end ON subscriptions(current_period_end)
  WHERE status IN ('active', 'past_due');
CREATE INDEX idx_subscriptions_grant_expiry ON subscriptions(grant_ends_at)
  WHERE grant_ends_at IS NOT NULL;
CREATE INDEX idx_subscriptions_pending_sync ON subscriptions(id)
  WHERE pending_plan_id IS NOT NULL AND pending_synced_at IS NULL;
CREATE INDEX idx_subscriptions_checkout ON subscriptions(checkout_token_hash)
  WHERE checkout_token_hash IS NOT NULL;

COMMENT ON TABLE subscriptions IS
  'The entitlement authority. One live subscription per organization plus terminated history. Amount and seats are snapshots, not a live join.';
COMMENT ON COLUMN subscriptions.grant_kind IS
  'How access was obtained. early_access and comp are operator grants with no charge and a mandatory end date.';


-- =============================================================================
-- Payments — the ledger
-- =============================================================================
--
-- EVERY attempt lands here, successful or not. A failed payment is the row an
-- operator most needs when a customer writes in, so recording only successes
-- would make the console useless exactly when it matters. A row is written when
-- checkout STARTS, so even an abandoned attempt is visible.
--
-- `expected_amount_minor` is what we computed before calling the gateway;
-- `amount_minor` is what the gateway reported. `amount_mismatch` is GENERATED
-- from the two, so it cannot be forgotten on an insert path or set by hand.

CREATE TABLE payments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                bigint NOT NULL DEFAULT public.new_public_id(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id          uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  plan_id                  uuid REFERENCES plans(id),

  provider                 text NOT NULL CHECK (provider IN ('razorpay', 'paypal')),
  provider_payment_id      text,
  provider_order_id        text,
  provider_invoice_id      text,
  provider_subscription_id text,

  -- initiated : checkout created, customer has not paid yet
  -- authorized: funds held or mandate authorised, not settled
  -- captured  : money moved. THE ONLY STATUS THAT GRANTS ENTITLEMENT.
  status                   text NOT NULL DEFAULT 'initiated'
                           CHECK (status IN ('initiated', 'authorized', 'captured',
                                             'failed', 'refunded', 'cancelled')),

  currency                 text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor             bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  expected_amount_minor    bigint
                           CHECK (expected_amount_minor IS NULL OR expected_amount_minor >= 0),
  amount_refunded_minor    bigint NOT NULL DEFAULT 0
                           CHECK (amount_refunded_minor >= 0
                                  AND amount_refunded_minor <= amount_minor),
  amount_mismatch          boolean GENERATED ALWAYS AS (
                             expected_amount_minor IS NOT NULL
                             AND amount_minor <> expected_amount_minor
                           ) STORED,

  seats                    integer CHECK (seats IS NULL OR seats >= 1),
  method                   text,       -- card, upi, netbanking, paypal
  error_code               text,
  error_description        text,
  description              text,

  billing_period_start     timestamptz,
  billing_period_end       timestamptz,

  -- The gateway's own object, for reconciliation and disputes. Column-revoked
  -- from end-user sessions below: it names the payer and their instrument.
  provider_payload         jsonb,

  captured_at              timestamptz,
  failed_at                timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payments_public_id_16_digits
    CHECK (public_id BETWEEN 1000000000000000 AND 8999999999999999),
  -- A capture cannot be claimed without the gateway's own identifier, which
  -- only a verified webhook or a server-to-server fetch can supply. This is the
  -- constraint that stops a bug, not just an attacker, from inventing revenue.
  CONSTRAINT payments_captured_has_id
    CHECK (status <> 'captured' OR provider_payment_id IS NOT NULL),
  CONSTRAINT payments_captured_has_time
    CHECK (status <> 'captured' OR captured_at IS NOT NULL)
);

CREATE UNIQUE INDEX payments_public_id_key ON payments(public_id);
-- Idempotency: a webhook retry naming the same gateway payment conflicts here
-- rather than writing a second ledger row.
CREATE UNIQUE INDEX payments_provider_payment_key
  ON payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX idx_payments_org ON payments(organization_id, created_at DESC);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_subscription ON payments(subscription_id, created_at DESC);
CREATE INDEX idx_payments_failures ON payments(created_at DESC) WHERE status = 'failed';
CREATE INDEX idx_payments_mismatch ON payments(created_at DESC) WHERE amount_mismatch;

COMMENT ON TABLE payments IS
  'Every payment attempt, successful or failed. Written only by the service role from a verified webhook or a background job.';
COMMENT ON COLUMN payments.amount_mismatch IS
  'Generated: the gateway charged something other than what we priced. Entitlement is withheld and the row is surfaced to operators.';


-- =============================================================================
-- Webhook event log
-- =============================================================================
--
-- Replay protection, and the raw payload when a payment is disputed months
-- later. Events that FAIL signature verification are recorded too: a burst of
-- them is the signal that someone is probing the endpoint.

CREATE TABLE payment_webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL CHECK (provider IN ('razorpay', 'paypal')),
  provider_event_id text NOT NULL,
  event_type        text NOT NULL,
  -- When the PROVIDER says it happened, for the ordering guard on subscriptions.
  event_at          timestamptz,
  signature_valid   boolean NOT NULL,
  status            text NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  attempts          integer NOT NULL DEFAULT 0,
  error             text,
  organization_id   uuid REFERENCES organizations(id) ON DELETE SET NULL,
  subscription_id   uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  payment_id        uuid REFERENCES payments(id) ON DELETE SET NULL,
  payload           jsonb NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_webhook_events_pending ON payment_webhook_events(received_at)
  WHERE status IN ('received', 'failed');
CREATE INDEX idx_webhook_events_invalid ON payment_webhook_events(received_at DESC)
  WHERE NOT signature_valid;

COMMENT ON TABLE payment_webhook_events IS
  'Raw gateway webhooks. The UNIQUE(provider, provider_event_id) is what makes a replayed webhook a no-op.';


-- =============================================================================
-- Billing invoices
-- =============================================================================
--
-- Ours, not the gateway's: issued as Vektra Corporation and, for Indian
-- customers, a compliant GST tax invoice.
--
-- Buyer and seller are SNAPSHOT at issue. An invoice is a statement about a
-- moment; re-reading the organization's current address would silently rewrite
-- history every time a customer moved office.
--
-- The tax columns are explicit rather than a jsonb blob so the CHECKs below can
-- make an incoherent invoice unstorable: an intra-state invoice carrying IGST,
-- or a total that does not equal the sum of its parts, cannot be written at all.

CREATE TABLE billing_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id        bigint NOT NULL DEFAULT public.new_public_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_id  uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  payment_id       uuid REFERENCES payments(id) ON DELETE SET NULL,

  invoice_number   text NOT NULL UNIQUE,
  series           text NOT NULL,
  fiscal_year      text NOT NULL,          -- '26-27'
  sequence_number  integer NOT NULL CHECK (sequence_number >= 1),
  issue_date       date NOT NULL DEFAULT CURRENT_DATE,

  status           text NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('issued', 'cancelled')),
  cancelled_reason text,

  -- Statutory treatment. Decides which tax columns may be non-zero.
  tax_treatment    text NOT NULL CHECK (tax_treatment IN (
                     'intra_state',       -- CGST + SGST
                     'inter_state',       -- IGST
                     'export_lut',        -- zero-rated, LUT on file
                     'export_with_igst'   -- zero-rated supply, IGST charged, refund claimed
                   )),

  seller_snapshot  jsonb NOT NULL,
  seller_gstin     text,
  seller_state     text,
  lut_arn          text,

  buyer_snapshot   jsonb NOT NULL,
  buyer_gstin      text,
  buyer_country    text NOT NULL CHECK (buyer_country ~ '^[A-Z]{2}$'),
  place_of_supply  text NOT NULL,          -- GST state code, or '96' for export
  sac_code         text NOT NULL DEFAULT '998314',
  reverse_charge   boolean NOT NULL DEFAULT false,

  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  taxable_minor    bigint NOT NULL CHECK (taxable_minor >= 0),
  -- Rates in basis points: 1800 = 18.00%. Integers, so no float ever touches a
  -- statutory figure.
  cgst_rate_bp     integer NOT NULL DEFAULT 0 CHECK (cgst_rate_bp BETWEEN 0 AND 10000),
  sgst_rate_bp     integer NOT NULL DEFAULT 0 CHECK (sgst_rate_bp BETWEEN 0 AND 10000),
  igst_rate_bp     integer NOT NULL DEFAULT 0 CHECK (igst_rate_bp BETWEEN 0 AND 10000),
  cgst_minor       bigint NOT NULL DEFAULT 0 CHECK (cgst_minor >= 0),
  sgst_minor       bigint NOT NULL DEFAULT 0 CHECK (sgst_minor >= 0),
  igst_minor       bigint NOT NULL DEFAULT 0 CHECK (igst_minor >= 0),
  total_minor      bigint NOT NULL CHECK (total_minor >= 0),

  -- An export invoice must also state its INR equivalent.
  fx_rate_to_inr   numeric(18, 6),
  total_inr_minor  bigint CHECK (total_inr_minor IS NULL OR total_inr_minor >= 0),

  quantity         integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  line_description text NOT NULL,
  period_start     date,
  period_end       date,

  pdf_storage_path text,
  pdf_generated_at timestamptz,
  last_emailed_at  timestamptz,
  email_count      integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (series, fiscal_year, sequence_number),
  CONSTRAINT billing_invoices_public_id_16_digits
    CHECK (public_id BETWEEN 1000000000000000 AND 8999999999999999),

  -- The arithmetic is a constraint, not a convention. A row whose parts do not
  -- add up cannot be stored, so no reader has to re-derive the total to trust it.
  CONSTRAINT billing_invoices_total_adds_up
    CHECK (total_minor = taxable_minor + cgst_minor + sgst_minor + igst_minor),

  -- Only the columns the treatment permits may be non-zero. The odd paisa on an
  -- intra-state split lands on SGST, so the two halves may differ by one.
  CONSTRAINT billing_invoices_tax_matches_treatment CHECK (
    CASE tax_treatment
      WHEN 'intra_state' THEN igst_minor = 0 AND igst_rate_bp = 0
                              AND cgst_rate_bp = sgst_rate_bp
                              AND abs(cgst_minor - sgst_minor) <= 1
      WHEN 'inter_state' THEN cgst_minor = 0 AND sgst_minor = 0
                              AND cgst_rate_bp = 0 AND sgst_rate_bp = 0
      WHEN 'export_lut'  THEN cgst_minor = 0 AND sgst_minor = 0 AND igst_minor = 0
      WHEN 'export_with_igst' THEN cgst_minor = 0 AND sgst_minor = 0
    END
  ),
  -- An Indian supply needs an Indian place of supply, and an export does not.
  CONSTRAINT billing_invoices_pos_matches_treatment CHECK (
    (tax_treatment IN ('intra_state', 'inter_state')
       AND buyer_country = 'IN' AND place_of_supply <> '96')
    OR (tax_treatment LIKE 'export%' AND buyer_country <> 'IN')
  ),
  -- Claiming LUT relief without an LUT reference is not a lawful invoice.
  CONSTRAINT billing_invoices_lut_present
    CHECK (tax_treatment <> 'export_lut' OR lut_arn IS NOT NULL),
  CONSTRAINT billing_invoices_export_has_inr CHECK (
    tax_treatment NOT LIKE 'export%'
    OR (fx_rate_to_inr IS NOT NULL AND total_inr_minor IS NOT NULL)
  )
);

CREATE UNIQUE INDEX billing_invoices_public_id_key ON billing_invoices(public_id);
CREATE INDEX idx_billing_invoices_org ON billing_invoices(organization_id, issue_date DESC);
-- One issued invoice per captured payment: the idempotency key for the job.
CREATE UNIQUE INDEX billing_invoices_one_per_payment
  ON billing_invoices(payment_id)
  WHERE payment_id IS NOT NULL AND status = 'issued';

COMMENT ON TABLE billing_invoices IS
  'Vektra Corporation invoices. Buyer and seller details are snapshots frozen at issue time, never a live join.';

-- Delivery attempts, so "please send it again" has an answer and a bounce is
-- visible. A 'queued' row is also the admin console's outbox: apps/admin holds
-- no gateway or mail credentials and cannot render a PDF, so a resend enqueues
-- here and the web app's cron job does the work.
CREATE TABLE billing_invoice_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          uuid NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  to_email            text NOT NULL,
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'sent', 'skipped', 'failed')),
  requested_by        text NOT NULL DEFAULT 'system'
                      CHECK (requested_by IN ('system', 'admin')),
  admin_user_id       uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  provider_message_id text,
  error               text,
  attempts            integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

CREATE INDEX idx_invoice_sends_queue ON billing_invoice_sends(created_at)
  WHERE status = 'queued';
CREATE INDEX idx_invoice_sends_invoice ON billing_invoice_sends(invoice_id, created_at DESC);


-- =============================================================================
-- Invoice numbering
-- =============================================================================
--
-- A tax invoice series must be gapless. A Postgres SEQUENCE is the wrong tool:
-- it is non-transactional, so a rolled-back invoice would burn a number and
-- leave a gap the GST rules do not permit. A counter row incremented inside the
-- issuing transaction rolls back with it. This is the deliberate divergence
-- from new_public_id(), which wants exactly the opposite property.

CREATE TABLE billing_invoice_sequences (
  series      text NOT NULL,
  fiscal_year text NOT NULL,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series, fiscal_year)
);

COMMENT ON TABLE billing_invoice_sequences IS
  'Gapless per-series, per-fiscal-year invoice counter. Moves only through next_billing_invoice_number().';

CREATE OR REPLACE FUNCTION public.next_billing_invoice_number(
  p_series text,
  p_date   date DEFAULT CURRENT_DATE
)
RETURNS TABLE (invoice_number text, fiscal_year text, sequence_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy_start integer;
  v_fy_key   text;
  v_number   integer;
BEGIN
  IF p_series !~ '^[A-Z]{2,6}$' THEN
    RAISE EXCEPTION 'invoice series must be 2-6 uppercase letters, got %', p_series;
  END IF;

  -- Indian financial year: 1 April to 31 March.
  v_fy_start := CASE WHEN extract(month FROM p_date) >= 4
                     THEN extract(year FROM p_date)::integer
                     ELSE extract(year FROM p_date)::integer - 1 END;
  v_fy_key := to_char(v_fy_start % 100, 'FM00') || '-'
              || to_char((v_fy_start + 1) % 100, 'FM00');

  INSERT INTO billing_invoice_sequences (series, fiscal_year, last_number)
  VALUES (p_series, v_fy_key, 1)
  ON CONFLICT (series, fiscal_year)
  DO UPDATE SET last_number = billing_invoice_sequences.last_number + 1,
                updated_at  = now()
  RETURNING billing_invoice_sequences.last_number INTO v_number;

  RETURN QUERY SELECT p_series || '/' || v_fy_key || '/' || lpad(v_number::text, 6, '0'),
                      v_fy_key, v_number;
END;
$$;

COMMENT ON FUNCTION public.next_billing_invoice_number IS
  'Claims the next gapless invoice number for a series and fiscal year. Format VC/26-27/000001.';

REVOKE ALL ON FUNCTION public.next_billing_invoice_number(text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_billing_invoice_number(text, date) TO service_role;


-- =============================================================================
-- Platform audit log
-- =============================================================================
--
-- audit_logs.organization_id is NOT NULL, and rightly so: that table is the
-- TENANT'S trail, rendered at /settings/audit-log and filtered by
-- organization_id. Relaxing it would create rows no tenant can see in a table
-- whose whole contract is that tenants read it, and would put operator identity
-- into tenant-readable rows.
--
-- Platform actions get their own table, with the admin_users posture from
-- 00009: invisible to every end-user role, and append-only. Where an action
-- also affects one tenant, the console writes BOTH — here for the operator
-- trail, and to audit_logs so the customer can see that support changed their
-- plan.

CREATE TABLE platform_audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  admin_email     text NOT NULL,
  action          text NOT NULL,          -- 'plan.created', 'subscription.comped'
  resource_type   text NOT NULL,
  resource_id     text,                   -- text: not every resource is a uuid
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  changes         jsonb,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_audit_created ON platform_audit_logs(created_at DESC);
CREATE INDEX idx_platform_audit_org ON platform_audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_platform_audit_action ON platform_audit_logs(action, created_at DESC);

-- reject_audit_mutation() exists, but its message names audit_logs, which would
-- send anyone debugging this to the wrong table.
CREATE OR REPLACE FUNCTION public.reject_platform_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_logs is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER platform_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON platform_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_audit_mutation();

COMMENT ON TABLE platform_audit_logs IS
  'Operator actions, including platform-wide ones with no tenant. Append-only and invisible to every end-user role.';


-- =============================================================================
-- Entitlement resolution
-- =============================================================================
--
-- The single authority for "which plan is this organization actually on".
-- Everything that gates a feature reads this, so the answer is decided in one
-- place — and, critically, NOT from organizations.plan_id, which is why the
-- column fix above is belt to this braces.
--
-- Precedence, highest first:
--   1. A live operator grant (early_access / comp) — full access, no charge.
--   2. A live paid subscription.
--   3. A live trial.
--   4. Starter. Never NULL, so a caller cannot fail open by missing a branch.

CREATE OR REPLACE FUNCTION public.org_entitlements(p_org uuid)
RETURNS TABLE (
  plan_id            uuid,
  plan_name          text,
  plan_tier          text,
  plan_display_name  text,
  features           jsonb,
  limits             jsonb,
  source             text,
  subscription_status text,
  current_period_end timestamptz,
  ends_at            timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT s.*,
           CASE
             WHEN s.grant_kind IN ('early_access', 'comp')
                  AND (s.grant_ends_at IS NULL OR s.grant_ends_at > now()) THEN 1
             WHEN s.grant_kind = 'paid'
                  AND s.status IN ('active', 'past_due', 'authenticated') THEN 2
             WHEN s.grant_kind = 'trial'
                  AND s.trial_ends_at > now() THEN 3
             ELSE 99
           END AS rank
    FROM subscriptions s
    WHERE s.organization_id = p_org
  ),
  best AS (
    SELECT * FROM ranked WHERE rank < 99 ORDER BY rank, created_at DESC LIMIT 1
  ),
  fallback AS (
    SELECT p.* FROM plans p
    WHERE p.tier = 'starter' AND p.organization_id IS NULL AND p.is_active
    ORDER BY p.sort_order LIMIT 1
  )
  SELECT
    COALESCE(bp.id, f.id),
    COALESCE(bp.name, f.name),
    COALESCE(bp.tier, f.tier),
    COALESCE(bp.display_name, f.display_name),
    COALESCE(bp.features, f.features),
    COALESCE(bp.limits, f.limits),
    COALESCE(
      CASE b.rank WHEN 1 THEN b.grant_kind WHEN 2 THEN 'paid' WHEN 3 THEN 'trial' END,
      'starter_default'),
    COALESCE(b.status, 'none'),
    b.current_period_end,
    COALESCE(b.grant_ends_at, b.trial_ends_at, b.current_period_end)
  FROM (SELECT 1) AS always_one_row
  LEFT JOIN fallback f ON true
  LEFT JOIN best b ON true
  LEFT JOIN plans bp ON bp.id = b.plan_id;
$$;

COMMENT ON FUNCTION public.org_entitlements IS
  'The plan an organization is actually entitled to, resolved from subscriptions. Never reads organizations.plan_id, and never returns NULL.';

GRANT EXECUTE ON FUNCTION public.org_entitlements(uuid) TO authenticated, service_role;

-- Seats, counted server-side. Never accepted from a client.
CREATE OR REPLACE FUNCTION public.billable_seats(p_org uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(count(*), 1)::integer
  FROM org_members WHERE organization_id = p_org;
$$;

GRANT EXECUTE ON FUNCTION public.billable_seats(uuid) TO authenticated, service_role;


-- =============================================================================
-- apply_plan_limits: mirror the resolved plan's ceilings into usage_counters
-- =============================================================================
--
-- The function whose absence made every metered limit fail open. checkPlanLimit
-- reads usage_counters.limit_value and treats NULL as unlimited, and nothing had
-- ever written it.
--
-- Metric names come from METERED_METRICS in @pm/shared; the mapping to keys
-- inside plans.limits is spelled out because the two vocabularies differ
-- (workflow_runs versus workflow_runs_per_month).

CREATE OR REPLACE FUNCTION public.apply_plan_limits(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits jsonb;
  v_start  date := date_trunc('month', CURRENT_DATE)::date;
  v_end    date := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
  v_metric text;
  v_key    text;
  v_value  bigint;
  v_map    jsonb := jsonb_build_object(
              'projects',      'projects',
              'storage_bytes', 'storage_bytes',
              'workflow_runs', 'workflow_runs_per_month',
              'portal_users',  'portal_users'
            );
BEGIN
  SELECT e.limits INTO v_limits FROM public.org_entitlements(p_org) e;
  IF v_limits IS NULL THEN
    RETURN;   -- no plan resolved: leave limits untouched rather than writing NULL
  END IF;

  FOR v_metric IN SELECT jsonb_object_keys(v_map) LOOP
    v_key := v_map ->> v_metric;

    -- A JSON null means unlimited and is stored as SQL NULL. A missing key means
    -- the plan does not describe this metric, which is also unlimited.
    IF jsonb_typeof(v_limits -> v_key) = 'number' THEN
      v_value := (v_limits ->> v_key)::bigint;
    ELSE
      v_value := NULL;
    END IF;

    INSERT INTO usage_counters (organization_id, metric, current_value, limit_value,
                                period_start, period_end)
    VALUES (p_org, v_metric, 0, v_value, v_start, v_end)
    ON CONFLICT (organization_id, metric, period_start)
    DO UPDATE SET limit_value = EXCLUDED.limit_value, updated_at = now();
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.apply_plan_limits IS
  'Mirrors the resolved plan''s numeric ceilings into usage_counters.limit_value. Fires on every subscription change.';

REVOKE ALL ON FUNCTION public.apply_plan_limits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_limits(uuid) TO service_role;

-- =============================================================================
-- Caps that a tenant cannot reset
-- =============================================================================
--
-- Narrowing increment_usage to the caller's own organization stops one tenant
-- attacking another, but it does not stop a tenant calling
-- increment_usage_self('projects', -9999) against themselves: the counter
-- clamps at zero and the cap evaporates.
--
-- So for the metrics that actually GATE creation, the cap reads the source
-- table instead. A counter is a number that a bug or an attacker can
-- desynchronise from reality; count(*) is reality. Both of these are in the
-- tens or low hundreds per tenant and sit behind an organization_id index, so
-- the scan costs nothing.
--
-- The remaining metrics (storage_bytes, workflow_runs, ai_tokens) stay
-- counter-based: they are additive over a period and cannot be recounted
-- cheaply. They meter, they do not gate.

CREATE OR REPLACE FUNCTION public.usage_actual(p_org uuid, p_metric text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_metric
    WHEN 'projects' THEN (
      SELECT count(*) FROM projects
      WHERE organization_id = p_org AND status <> 'archived')
    WHEN 'portal_users' THEN (
      SELECT count(*) FROM portal_users
      WHERE organization_id = p_org AND status <> 'disabled')
    ELSE (
      SELECT COALESCE(current_value, 0) FROM usage_counters
      WHERE organization_id = p_org AND metric = p_metric
      ORDER BY period_start DESC LIMIT 1)
  END::bigint;
$$;

COMMENT ON FUNCTION public.usage_actual IS
  'Current usage for a metric. Recounts the source table for the metrics that gate creation, so a tampered counter cannot lift a cap.';

GRANT EXECUTE ON FUNCTION public.usage_actual(uuid, text) TO authenticated, service_role;

-- Fails closed: no tenant context, or an unresolvable plan, means no.
CREATE OR REPLACE FUNCTION public.can_create(p_metric text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org    uuid := public.org_id();
  v_limits jsonb;
  v_limit  bigint;
  v_key    text := CASE p_metric
                     WHEN 'workflow_runs' THEN 'workflow_runs_per_month'
                     ELSE p_metric
                   END;
BEGIN
  IF v_org IS NULL THEN RETURN false; END IF;

  SELECT e.limits INTO v_limits FROM public.org_entitlements(v_org) e;
  IF v_limits IS NULL THEN RETURN false; END IF;

  IF jsonb_typeof(v_limits -> v_key) <> 'number' THEN
    RETURN true;   -- absent or JSON null: unlimited
  END IF;

  v_limit := (v_limits ->> v_key)::bigint;
  RETURN public.usage_actual(v_org, p_metric) < v_limit;
END;
$$;

COMMENT ON FUNCTION public.can_create IS
  'Whether the caller''s organization may create one more of a metered thing. Authoritative: recounts rather than trusting usage_counters.';

GRANT EXECUTE ON FUNCTION public.can_create(text) TO authenticated, service_role;


-- Keeping the counters current is not something a call site should have to
-- remember, so the table that changes entitlement drives it.
CREATE OR REPLACE FUNCTION public.subscriptions_apply_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.apply_plan_limits(NEW.organization_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER subscriptions_apply_limits_trigger
  AFTER INSERT OR UPDATE OF plan_id, status, grant_kind, grant_ends_at
  ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_apply_limits();

-- Backfill: every existing tenant currently has no limit_value at all.
SELECT public.apply_plan_limits(id) FROM organizations;


-- =============================================================================
-- current_auth_context: carry the resolved entitlement
-- =============================================================================
--
-- Replaces the 00013 version. Feature gates previously read a hardcoded
-- TypeScript constant keyed by plan name, so a custom plan gated nothing. The
-- resolved limits/features ride along on the context call every layout, page and
-- action already makes, so this costs no extra round trip.
--
-- plan_name now comes from org_entitlements(), NOT from organizations.plan_id.
-- That alone makes tampering with that column worthless.

DROP FUNCTION IF EXISTS public.current_auth_context(text);

CREATE OR REPLACE FUNCTION public.current_auth_context(p_org_slug text DEFAULT NULL)
RETURNS TABLE (
  organization_id     uuid,
  org_role            text,
  org_slug            text,
  org_timezone        text,
  org_currency        text,
  org_status          text,
  billing_country     text,
  plan_name           text,
  plan_tier           text,
  plan_display_name   text,
  plan_limits         jsonb,
  plan_features       jsonb,
  entitlement_source  text,
  subscription_status text,
  permissions         jsonb
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
    o.billing_country,
    e.plan_name,
    e.plan_tier,
    e.plan_display_name,
    e.limits,
    e.features,
    e.source,
    e.subscription_status,
    r.permissions
  FROM org_members om
  JOIN organizations o ON o.id = om.organization_id
  LEFT JOIN LATERAL public.org_entitlements(om.organization_id) e ON true
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
  'Tenant context in one round trip, including the resolved plan entitlement so gating is database-driven rather than keyed on a plan name.';

REVOKE EXECUTE ON FUNCTION public.current_auth_context(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_auth_context(text) TO authenticated;


-- ===== RLS =====
--
-- Billing rows are read-only to tenants and written only by the service role
-- from a signature-verified webhook or a background job. None of these tables
-- gets an INSERT, UPDATE or DELETE policy — that absence IS the control that
-- stops a customer granting themselves a plan through PostgREST.
--
-- The REVOKEs below are not decoration. 00009 sets ALTER DEFAULT PRIVILEGES
-- granting SELECT/INSERT/UPDATE/DELETE on newly created tables to
-- `authenticated`, so every table in this file is born writable and RLS is all
-- that stands in front of it. Removing the privilege outright is the stronger
-- statement, and it fails safe if a later migration ever adds a policy
-- carelessly.

ALTER TABLE plan_prices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_plan_refs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoice_sends     ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_logs       ENABLE ROW LEVEL SECURITY;

-- Plans: the catalogue stays public for the signed-out pricing page, but a
-- custom plan belongs to one tenant. anon has org_id() NULL, so only the
-- catalogue arm can ever match for it. The third arm keeps the plan an org is
-- actually ON readable even after it has been retired from the catalogue.
DROP POLICY IF EXISTS "Anyone can read active plans" ON plans;

CREATE POLICY "Catalogue is public, custom plans are tenant-scoped" ON plans
  FOR SELECT USING (
    (is_active AND organization_id IS NULL)
    OR organization_id = public.org_id()
    OR id = (SELECT e.plan_id FROM public.org_entitlements(public.org_id()) e)
  );

-- Prices inherit their plan's visibility rather than restating the rule.
CREATE POLICY "Prices follow their plan" ON plan_prices
  FOR SELECT USING (
    is_active
    AND EXISTS (
      SELECT 1 FROM plans p
      WHERE p.id = plan_prices.plan_id
        AND p.is_active
        AND (p.organization_id IS NULL OR p.organization_id = public.org_id())
    )
  );

-- Billing history is an administrative fact about the tenant, so it follows the
-- same boundary as the billing settings page: admins and owners, own org only.
CREATE POLICY "Org admins read their subscriptions" ON subscriptions
  FOR SELECT USING (
    organization_id = public.org_id() AND public.has_org_role('admin')
  );

CREATE POLICY "Org admins read their payments" ON payments
  FOR SELECT USING (
    organization_id = public.org_id() AND public.has_org_role('admin')
  );

CREATE POLICY "Org admins read their invoices" ON billing_invoices
  FOR SELECT USING (
    organization_id = public.org_id() AND public.has_org_role('admin')
  );

CREATE POLICY "Org admins read their invoice deliveries" ON billing_invoice_sends
  FOR SELECT USING (
    organization_id = public.org_id() AND public.has_org_role('admin')
  );

-- provider_plan_refs, payment_webhook_events, billing_invoice_sequences and
-- platform_audit_logs get NO policy at all: RLS is enabled and nothing matches,
-- so an end-user session reads nothing. They are operator and machine state.

REVOKE INSERT, UPDATE, DELETE ON
  plans, plan_prices, subscriptions, payments, billing_invoices, billing_invoice_sends
  FROM authenticated, anon;

REVOKE ALL ON
  provider_plan_refs, payment_webhook_events,
  billing_invoice_sequences, platform_audit_logs
  FROM authenticated, anon;

-- The gateway's own payload names the payer and their instrument. RLS restricts
-- which ROWS an admin sees; this restricts which of their columns.
DO $$
BEGIN
  PERFORM public.grant_columns_except(
    'payments', 'SELECT', ARRAY['provider_payload'], 'authenticated');
END $$;

-- Picks up every table added above that carries updated_at.
SELECT public.apply_updated_at_triggers();
