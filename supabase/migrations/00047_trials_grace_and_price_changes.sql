-- =============================================================================
-- 00047: trials that actually grant, a bounded grace period, and price changes
--        that land on the next cycle
-- =============================================================================
--
-- Three defects and one new capability, all in the same area:
--
--  1. THE TRIAL GRANTED NOTHING. create_organization (00001) wrote a 14-day
--     trial to organizations.trial_ends_at and organizations.plan_id. 00037
--     made subscriptions the entitlement authority and org_entitlements() does
--     not read either column, so every organization created since 00037 has had
--     a trial recorded in a place nothing consults — and resolved to
--     starter_default from the moment it was created.
--
--  2. A TRIAL WOULD HAVE BLOCKED CHECKOUT. subscriptions_one_live_per_org
--     covers any live status regardless of provider, so a live trial row
--     occupies the single slot and the paid INSERT fails with 23505. The index
--     exists to make double-CHARGING impossible; a manual grant never charges,
--     so scoping it to gateway-backed rows preserves the guarantee it was
--     written for and stops it blocking an upgrade.
--
--  3. PAST_DUE WAS UNBOUNDED. past_due is in LIVE_SUBSCRIPTION_STATUSES, so a
--     failing subscription kept full access forever. Nothing recorded WHEN it
--     entered past_due, so a grace period could not be enforced even by a job.
--
--  4. NEW: a price change must not touch anyone already paying. The snapshot
--     columns on subscriptions already guarantee that. What was missing is the
--     other half — moving them to the new price at their next renewal.

-- -----------------------------------------------------------------------------
-- 1. Grace period: record when past_due began
-- -----------------------------------------------------------------------------

ALTER TABLE subscriptions
  ADD COLUMN past_due_since timestamptz;

COMMENT ON COLUMN subscriptions.past_due_since IS
  'When the subscription first entered past_due. Start of the grace window; cleared on recovery.';

/**
 * Maintain past_due_since from the status transition itself.
 *
 * A trigger rather than an application concern: past_due is reachable from the
 * webhook, from an operator action and from the lapse job, and a grace period
 * that depends on every writer remembering to stamp a column is a grace period
 * that will eventually be infinite for somebody.
 */
CREATE OR REPLACE FUNCTION public.track_past_due_since()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'past_due' AND (OLD.status IS DISTINCT FROM 'past_due') THEN
    -- Keep the ORIGINAL entry time if it is already set: a retry that flips
    -- past_due -> past_due must not restart the clock.
    NEW.past_due_since := COALESCE(NEW.past_due_since, OLD.past_due_since, now());
  ELSIF NEW.status <> 'past_due' THEN
    NEW.past_due_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_track_past_due
  BEFORE UPDATE OF status ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.track_past_due_since();

CREATE INDEX idx_subscriptions_grace_expiry ON subscriptions(past_due_since)
  WHERE status = 'past_due';

-- -----------------------------------------------------------------------------
-- 2. Rescope the single-live-subscription guarantee to gateway-backed rows
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS subscriptions_one_live_per_org;

-- One live PAID subscription per tenant. Still the thing that makes a double
-- charge a unique violation rather than a race to win.
CREATE UNIQUE INDEX subscriptions_one_live_paid_per_org
  ON subscriptions(organization_id)
  WHERE provider <> 'manual'
    AND status IN ('pending', 'authenticated', 'active', 'past_due', 'paused');

-- And one live GRANT per tenant, so trials cannot accumulate. A tenant may hold
-- both a grant and a paid subscription at once — org_entitlements() already
-- ranks a comp above paid and paid above a trial, which is the behaviour we
-- want while a trial is being upgraded.
CREATE UNIQUE INDEX subscriptions_one_live_grant_per_org
  ON subscriptions(organization_id)
  WHERE provider = 'manual'
    AND status IN ('pending', 'authenticated', 'active', 'past_due', 'paused');

-- -----------------------------------------------------------------------------
-- 3. Trials that the entitlement authority can actually see
-- -----------------------------------------------------------------------------

/** Length of a new organization's trial. */
CREATE OR REPLACE FUNCTION public.trial_period_days() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 14 $$;

/** How long a failing subscription keeps access while retries run. */
CREATE OR REPLACE FUNCTION public.grace_period_days() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 14 $$;

/**
 * Give an organization its trial.
 *
 * provider = 'manual' is forced by subscriptions_manual_is_a_grant: a trial is
 * a grant, and a grant has no gateway behind it. The plan granted is Growth —
 * a trial of the free tier would be indistinguishable from no trial at all.
 */
CREATE OR REPLACE FUNCTION public.grant_trial(p_org uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan  uuid;
  v_price uuid;
  v_id    uuid;
BEGIN
  SELECT id INTO v_plan
  FROM plans
  WHERE tier = 'growth' AND organization_id IS NULL AND is_active
  ORDER BY sort_order LIMIT 1;

  IF v_plan IS NULL THEN RETURN NULL; END IF;

  -- Snapshot a price if one exists, so the trial row carries the same shape as
  -- a paid one and reporting does not have to special-case it.
  SELECT id INTO v_price
  FROM plan_prices
  WHERE plan_id = v_plan AND billing_interval = 'monthly' AND is_active
  ORDER BY currency LIMIT 1;

  INSERT INTO subscriptions (
    organization_id, plan_id, plan_price_id, grant_kind, provider, status,
    currency, billing_interval, unit_amount_minor, seats, trial_ends_at
  )
  VALUES (
    p_org, v_plan, v_price, 'trial', 'manual', 'active',
    COALESCE((SELECT currency FROM plan_prices WHERE id = v_price), 'INR'),
    'monthly',
    COALESCE((SELECT unit_amount_minor FROM plan_prices WHERE id = v_price), 0),
    1,
    now() + make_interval(days => public.trial_period_days())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_trial(uuid) TO service_role;

-- create_organization now grants the trial through the authority that is
-- actually consulted. organizations.trial_ends_at is still written so the
-- admin console's existing column keeps working, but it grants nothing.
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_slug text,
  p_timezone text DEFAULT 'UTC',
  p_currency text DEFAULT 'USD'
)
RETURNS organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org  organizations;
  v_ws   uuid;
  v_plan uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO v_plan FROM plans WHERE name = 'starter';

  INSERT INTO organizations (name, slug, timezone, currency, status, plan_id, trial_ends_at)
  VALUES (p_name, p_slug, p_timezone, p_currency, 'trial', v_plan,
          now() + make_interval(days => public.trial_period_days()))
  RETURNING * INTO v_org;

  UPDATE org_members SET is_default = false WHERE user_id = v_user AND is_default;

  INSERT INTO org_members (organization_id, user_id, role, is_default)
  VALUES (v_org.id, v_user, 'owner', true);

  INSERT INTO workspaces (organization_id, name, slug, description, created_by)
  VALUES (v_org.id, 'General', 'general', 'Default workspace', v_user)
  RETURNING id INTO v_ws;

  INSERT INTO workspace_members (workspace_id, user_id, organization_id, role)
  VALUES (v_ws, v_user, v_org.id, 'admin');

  PERFORM public.grant_trial(v_org.id);

  RETURN v_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_organization(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, text) TO authenticated;

-- Backfill: organizations still inside their original trial window get the
-- subscription row that window was always supposed to have.
INSERT INTO subscriptions (
  organization_id, plan_id, grant_kind, provider, status,
  currency, billing_interval, unit_amount_minor, seats, trial_ends_at
)
SELECT
  o.id,
  (SELECT id FROM plans WHERE tier = 'growth' AND organization_id IS NULL AND is_active
   ORDER BY sort_order LIMIT 1),
  'trial', 'manual', 'active',
  'INR', 'monthly', 0, 1,
  o.trial_ends_at
FROM organizations o
WHERE o.trial_ends_at IS NOT NULL
  AND o.trial_ends_at > now()
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id)
  AND EXISTS (SELECT 1 FROM plans WHERE tier = 'growth' AND organization_id IS NULL AND is_active);

-- -----------------------------------------------------------------------------
-- 4. Expiry and lapse, as one job the cron can call
-- -----------------------------------------------------------------------------

/**
 * Close out trials that have run out and subscriptions whose grace has expired.
 *
 * Written as a database function rather than an application loop so the whole
 * sweep is one statement per class: a partial failure cannot leave half the
 * tenants expired. Returns the counts so the job can log something meaningful.
 */
CREATE OR REPLACE FUNCTION public.expire_trials_and_lapse_overdue()
RETURNS TABLE (trials_expired integer, subscriptions_lapsed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trials integer;
  v_lapsed integer;
BEGIN
  WITH expired AS (
    UPDATE subscriptions
       SET status = 'expired', ended_at = now()
     WHERE grant_kind = 'trial'
       AND status IN ('active', 'pending', 'authenticated')
       AND trial_ends_at IS NOT NULL
       AND trial_ends_at <= now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_trials FROM expired;

  WITH lapsed AS (
    UPDATE subscriptions
       SET status = 'lapsed', ended_at = now()
     WHERE status = 'past_due'
       AND past_due_since IS NOT NULL
       AND past_due_since <= now() - make_interval(days => public.grace_period_days())
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_lapsed FROM lapsed;

  RETURN QUERY SELECT v_trials, v_lapsed;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_trials_and_lapse_overdue() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_trials_and_lapse_overdue() TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Price changes that land on the next cycle
-- -----------------------------------------------------------------------------
--
-- What already holds: subscriptions.unit_amount_minor is a SNAPSHOT, so editing
-- plan_prices cannot change what an existing subscriber is charged. That is the
-- "must not reflect immediately" half, and it is structural.
--
-- This is the other half. Marking the live subscriptions on a price as pending
-- is what a sync job later pushes to the gateway with a cycle-end schedule, so
-- the new amount takes effect at renewal and not before.

/**
 * Queue every live paid subscription on a price for a move at next renewal.
 *
 * A price is edited IN PLACE rather than superseded by a new row, because
 * plan_prices carries UNIQUE (plan_id, currency, billing_interval) — an old and
 * a new row for the same plan cannot coexist. That is fine, because what
 * protects existing subscribers is not the price row: it is
 * subscriptions.unit_amount_minor, which is a snapshot taken at signup. Editing
 * the catalogue cannot change what anybody is charged today.
 *
 * This marks the affected subscriptions as pending so the sync job pushes the
 * new amount to the gateway with a cycle-end schedule. The snapshot is rewritten
 * only when the next charge actually lands, which is the moment the customer
 * genuinely moved onto the new price.
 *
 * Only 'paid' rows: a comp or a trial has no amount to change.
 */
CREATE OR REPLACE FUNCTION public.schedule_price_change(
  p_price_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_plan  uuid;
BEGIN
  SELECT plan_id INTO v_plan FROM plan_prices WHERE id = p_price_id;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'unknown plan price %', p_price_id;
  END IF;

  WITH queued AS (
    UPDATE subscriptions
       SET pending_plan_id   = v_plan,
           pending_price_id  = p_price_id,
           pending_reason    = COALESCE(p_reason, 'price change'),
           pending_synced_at = NULL
     WHERE plan_price_id = p_price_id
       AND grant_kind = 'paid'
       AND provider <> 'manual'
       AND status IN ('active', 'past_due', 'authenticated')
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM queued;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_price_change(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_price_change(uuid, text) TO service_role;

/**
 * Apply a synced pending change once the new cycle's charge has landed.
 *
 * This is the moment the customer actually moved onto the new price: the gateway
 * has debited the new amount, so the snapshot may finally be rewritten. Doing it
 * any earlier would misreport what they are paying; doing it never would leave
 * the snapshot permanently stale.
 */
CREATE OR REPLACE FUNCTION public.apply_pending_change(p_subscription_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_applied boolean := false;
BEGIN
  UPDATE subscriptions s
     SET plan_id           = COALESCE(s.pending_plan_id, s.plan_id),
         plan_price_id     = COALESCE(s.pending_price_id, s.plan_price_id),
         seats             = COALESCE(s.pending_seats, s.seats),
         unit_amount_minor = COALESCE(
                               (SELECT pp.unit_amount_minor FROM plan_prices pp
                                 WHERE pp.id = s.pending_price_id),
                               s.unit_amount_minor),
         pending_plan_id   = NULL,
         pending_price_id  = NULL,
         pending_seats     = NULL,
         pending_reason    = NULL,
         pending_synced_at = NULL
   WHERE s.id = p_subscription_id
     AND s.pending_price_id IS NOT NULL
     -- Only a change the gateway has already accepted. An unsynced pending row
     -- is still being charged at the old amount.
     AND s.pending_synced_at IS NOT NULL;

  v_applied := FOUND;
  RETURN v_applied;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pending_change(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pending_change(uuid) TO service_role;

COMMENT ON FUNCTION public.schedule_price_change IS
  'Queue live paid subscriptions on an old price to move to a new one at their next renewal. Never changes what is charged now.';

-- -----------------------------------------------------------------------------
-- 6. Invoice PDF storage
-- -----------------------------------------------------------------------------
--
-- Private, and deliberately with NO storage policies for end-user roles. A tax
-- invoice names the buyer and the amount, so access is decided by the app: the
-- billing route checks org role, then mints a short-lived signed URL with the
-- service role. Giving `authenticated` a direct policy here would mean the
-- bucket, not the route, was the access-control boundary.
--
-- Paths are prefixed with the organization id (§13.9) so a leaked signed URL
-- cannot be edited into another tenant's invoice.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('invoices', 'invoices', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
