-- =============================================================================
-- 00049_tax_inclusive_pricing_and_billing_profile
--
-- 1. CATALOGUE PRICES BECOME TAX-INCLUSIVE.
--
--    00037 stored `plan_prices.unit_amount_minor` tax-EXCLUSIVE and added GST at
--    checkout, so an operator who typed 499 produced a ₹588.82 debit. That is a
--    defensible accounting choice and the wrong product choice: the number typed
--    into the pricing page is the number the business has decided to charge, and
--    everyone downstream — the customer, the pricing page, the support
--    conversation — means the same thing by it.
--
--    The price is now the CHARGE. Tax is decomposed out of it at invoice time:
--
--        taxable = round(gross * 10000 / (10000 + rate_bp))
--        tax     = gross - taxable
--
--    00037's objection to inclusive storage was that it makes the invoice's
--    taxable line unreconstructable without re-deriving a rate. Defining the tax
--    as the REMAINDER answers that: `taxable + tax = gross` holds exactly, for
--    every input, without the rounding drift that recomputing the tax from the
--    derived base would introduce (at 18%, a gross of 115 backs out to 97, and
--    18% of 97 rounds to 17 — totalling 114, a paisa short of what was quoted).
--
-- 2. A BILLING PROFILE THAT CAN NAME THE BUYER.
--
--    A tax invoice must carry the buyer's legal entity name, which is routinely
--    not the workspace name someone typed at signup ("Acme" vs "Acme Technology
--    Private Limited"). Invoices were using `organizations.name`, so every
--    Indian invoice named the wrong entity. GSTIN stays optional, because
--    unregistered buyers exist and a B2C invoice is perfectly valid without one.
-- =============================================================================


-- =============================================================================
-- 1. Convert existing INR prices from exclusive to inclusive
-- =============================================================================
--
-- ONLY INR. An INR price is by definition a domestic supply, which is where the
-- 18% was being added, so multiplying by 1.18 leaves every existing Indian
-- customer being charged exactly what they are charged today — the change is to
-- what the NUMBER MEANS, not to anyone's bill.
--
-- Non-INR rows are exports. Under a valid LUT they are zero-rated, so no tax was
-- ever added and gross already equals net — converting them would be a silent
-- price rise. The one case that does shift is an export with no LUT on file,
-- which was charged +18% and will now be charged the quoted figure; that path
-- already sets `requiresOperatorAttention` precisely because it needs a human
-- looking at it, and quoting a price and then charging more than it is the worse
-- of the two behaviours.
--
-- Rounded half-up to the paisa, matching grossFromNet() in the application.

UPDATE plan_prices
   SET unit_amount_minor = round(unit_amount_minor * 1.18)::bigint
 WHERE currency = 'INR';

COMMENT ON TABLE plan_prices IS
  'Per-seat price in integer minor units, TAX-INCLUSIVE: the figure the customer is charged. One row per plan/currency/interval.';
COMMENT ON COLUMN plan_prices.unit_amount_minor IS
  'TAX-INCLUSIVE per-seat charge. GST is decomposed out of this at invoice time (tax = gross - taxable), never added on top.';

-- Live subscriptions carry a SNAPSHOT of the price they were sold at (00037),
-- and that snapshot fed the same exclusive-then-add-tax path. Converting it
-- keeps each existing mandate charging what it charges today under the new
-- inclusive arithmetic.
--
-- Grants are excluded: unit_amount_minor is 0 on those by definition, and
-- multiplying zero is pointless but scanning them is not free.
UPDATE subscriptions
   SET unit_amount_minor = round(unit_amount_minor * 1.18)::bigint
 WHERE currency = 'INR'
   AND unit_amount_minor > 0
   AND provider <> 'manual';

COMMENT ON COLUMN subscriptions.unit_amount_minor IS
  'TAX-INCLUSIVE per-seat amount this subscription was sold at. A snapshot, not a live join to plan_prices.';

-- provider_plan_refs.amount_minor was ALREADY the tax-inclusive figure the
-- gateway charges (00037), so it is deliberately left untouched. It was correct
-- before this migration and is correct after it — only the route to computing it
-- has changed.


-- =============================================================================
-- 2. Billing profile: the buyer's legal name
-- =============================================================================

ALTER TABLE organizations ADD COLUMN billing_legal_name text;

COMMENT ON COLUMN organizations.billing_legal_name IS
  'Registered entity name for tax invoices, when it differs from the workspace name. Invoices fall back to organizations.name when null.';

-- Entitlement-adjacent columns are operator- and RPC-owned (00037); this one is
-- not. It is ordinary billing detail the owner edits on their own settings page,
-- so it follows `billing_email` and stays writable by the tenant.
DO $$
BEGIN
  PERFORM public.grant_columns_except(
    'organizations', 'UPDATE',
    ARRAY['plan_id', 'status', 'trial_ends_at',
          'billing_country', 'billing_state', 'payment_provider',
          'status_reason', 'status_changed_at', 'status_changed_by_admin_id',
          'stripe_customer_id', 'stripe_subscription_id'],
    'authenticated');
END $$;


-- =============================================================================
-- 3. set_billing_profile() also carries the legal name
-- =============================================================================
--
-- Same owner-only, country-locked contract as 00037, plus the legal name.
--
-- The three-argument version is DROPPED rather than left in place. Postgres
-- overloads on argument count, so CREATE OR REPLACE with a fourth defaulted
-- parameter would ADD a function instead of replacing one — and a three-argument
-- call would then match both and fail as ambiguous. Dropping first is what makes
-- this a replacement.

DROP FUNCTION IF EXISTS public.set_billing_profile(text, text, text);

CREATE OR REPLACE FUNCTION public.set_billing_profile(
  p_country    text,
  p_state      text DEFAULT NULL,
  p_gstin      text DEFAULT NULL,
  p_legal_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := auth.org_id();
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no organization in context' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF auth.org_role() <> 'owner' THEN
    RAISE EXCEPTION 'only an owner may change the billing profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Moving country would change both the gateway holding the mandate and the
  -- tax treatment of an in-flight billing relationship.
  IF EXISTS (
    SELECT 1 FROM subscriptions
     WHERE organization_id = v_org
       AND provider <> 'manual'
       AND status IN ('pending', 'authenticated', 'active', 'past_due', 'paused')
  ) AND (SELECT billing_country FROM organizations WHERE id = v_org) IS DISTINCT FROM p_country
  THEN
    RAISE EXCEPTION 'billing country cannot change while a subscription is live'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE organizations
     SET billing_country    = p_country,
         billing_state      = p_state,
         gstin              = NULLIF(btrim(p_gstin), ''),
         billing_legal_name = NULLIF(btrim(p_legal_name), '')
   WHERE id = v_org;
END;
$$;

REVOKE ALL ON FUNCTION public.set_billing_profile(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_billing_profile(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.set_billing_profile(text, text, text, text) IS
  'Owner-only billing profile edit. GSTIN and legal name are optional; country is locked while a gateway subscription is live.';
