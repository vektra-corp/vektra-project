-- =============================================================================
-- 00050_fix_set_billing_profile
--
-- HOTFIX. 00049 added a legal-name argument to set_billing_profile() and, in
-- doing so, rewrote the function body from scratch instead of preserving the
-- one 00037 shipped. The rewrite called `auth.org_id()` and `auth.org_role()`,
-- which do not exist — the helpers in this schema are `public.org_id()` and
-- `public.has_org_role()`. Every save on the billing settings page failed with
--
--     function auth.org_id() does not exist
--
-- and because the old three-argument version had been dropped, there was
-- nothing left to fall back to. This restores 00037's body verbatim and adds
-- only the legal name.
--
-- The lesson worth keeping: CREATE OR REPLACE on a function you did not write
-- is a rewrite, not an edit. The body has to be carried across deliberately.
--
-- One behavioural change IS intended here, and it is called out rather than
-- smuggled in with the fix — see part 2.
-- =============================================================================

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
  v_org      uuid := public.org_id();
  v_existing text;
  v_live     boolean;
BEGIN
  IF v_org IS NULL OR NOT public.has_org_role('owner') THEN
    RAISE EXCEPTION 'Only an owner can change billing details'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'billing country must be a 2-letter ISO code';
  END IF;

  SELECT billing_country INTO v_existing FROM organizations WHERE id = v_org;

  -- =========================================================================
  -- 2. A GRANT NO LONGER FREEZES THE BILLING COUNTRY.
  --
  -- The original test was `status IN ('pending','active','past_due')` with no
  -- filter on provider. Every new organization is given a trial through
  -- grant_trial() (00047), which inserts provider='manual', status='active' —
  -- so from the moment an org is created it had a "live subscription", and the
  -- country it had never set was already frozen. A trialing customer could
  -- therefore never set a billing country, and without one they cannot check
  -- out at all: the trial locked them out of becoming a paying customer.
  --
  -- What the freeze is actually protecting is a GATEWAY MANDATE — an agreement
  -- held at Razorpay or PayPal in a particular currency, under a particular tax
  -- treatment. A manual grant has no mandate behind it and nothing to protect,
  -- so it is excluded.
  -- =========================================================================
  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE organization_id = v_org
      AND provider <> 'manual'
      AND status IN ('pending', 'active', 'past_due')
  ) INTO v_live;

  IF v_live AND v_existing IS DISTINCT FROM p_country THEN
    RAISE EXCEPTION 'Billing country cannot change while a subscription is live';
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
  'Owner-only billing profile edit. GSTIN and legal name are optional. The country is locked only while a GATEWAY-backed subscription is live — a manual grant such as a trial does not freeze it.';
