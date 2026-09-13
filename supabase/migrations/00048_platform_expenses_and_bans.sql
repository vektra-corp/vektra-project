-- =============================================================================
-- 00048_platform_expenses_and_bans
--
-- Two things the admin console needs and the schema could not express.
--
-- 1. EXPENSE. The global dashboard reports revenue against cost, and there was
--    no cost anywhere in the schema — not a table, not a column. Revenue is
--    derivable (captured payments less refunds); expense is not derivable from
--    anything, so it is recorded. `platform_expenses` is platform-level and
--    deliberately has NO organization_id: these are the company's costs, not a
--    tenant's, and giving them a tenant column would invite them into
--    tenant-scoped reporting where they do not belong.
--
-- 2. BAN. `organizations.status` had no way to say "this tenant is out for
--    cause". Suspension and a ban are different facts — one is usually billing
--    and reversible, the other is a policy decision — and collapsing them into
--    one value loses the distinction exactly when an operator needs it. Both now
--    also record WHO did it and WHY, because a status that changed with no
--    attribution is the thing support cannot explain three months later.
--
-- The organizing constraint, as in 00037: nothing here is writable by an
-- end-user session. Expenses are invisible to tenants entirely, and the new
-- status columns are operator-only.
-- =============================================================================


-- =============================================================================
-- 1. Platform expenses
-- =============================================================================
--
-- Minor units and an explicit currency, matching the billing module (00037).
-- A bigint with no currency beside it is not an amount, and these are summed
-- against payments, which are already stored that way.
--
-- `incurred_on` is a date, not a timestamp: an expense belongs to an accounting
-- period, and a timezone on it would only create disagreement about which month
-- it lands in.

CREATE TABLE platform_expenses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category             text NOT NULL CHECK (category IN (
                         'infrastructure',   -- Supabase, Vercel, Upstash
                         'gateway_fees',     -- Razorpay / PayPal cuts
                         'salaries',
                         'marketing',
                         'software',         -- third-party tooling
                         'support',
                         'other'
                       )),
  description          text NOT NULL,
  amount_minor         bigint NOT NULL CHECK (amount_minor >= 0),
  currency             text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  incurred_on          date NOT NULL,
  notes                text,

  -- Attribution, same posture as platform_audit_logs: the email is denormalized
  -- so the record still reads correctly after an operator row is removed.
  recorded_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  recorded_by_email    text NOT NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_expenses_incurred ON platform_expenses(incurred_on DESC);
CREATE INDEX idx_platform_expenses_category ON platform_expenses(category, incurred_on DESC);

COMMENT ON TABLE platform_expenses IS
  'Company operating costs, recorded by operators. Platform-level: deliberately has no organization_id. Invisible to every end-user role.';
COMMENT ON COLUMN platform_expenses.amount_minor IS
  'Integer minor units, matching payments.amount_minor so the two can be summed without a float round trip.';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 00009 sets ALTER DEFAULT PRIVILEGES granting authenticated full DML on every
-- NEW table in this schema. That is a sensible default for tenant tables and
-- completely wrong here, so it is revoked explicitly rather than relied upon to
-- have not applied. RLS is enabled with no policy as the second layer: even if
-- a grant were restored by accident, there is no policy to let a row through.
ALTER TABLE platform_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_expenses FROM anon, authenticated;


-- =============================================================================
-- 2. Ban as a distinct status, with attribution
-- =============================================================================

-- The CHECK is looked up rather than named, because an inline CHECK written in
-- 00001 carries a generated name. Dropping a guessed name with IF EXISTS would
-- silently no-op and leave the old constraint in place, still rejecting
-- 'banned' — a failure that would not surface until an operator clicked Ban.
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.organizations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
    AND pg_get_constraintdef(oid) LIKE '%churned%'
  LIMIT 1;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'organizations status CHECK not found; refusing to add a second one';
  END IF;

  EXECUTE format('ALTER TABLE organizations DROP CONSTRAINT %I', v_name);
END $$;

ALTER TABLE organizations ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active', 'trial', 'suspended', 'banned', 'churned'));

-- Why, who, and when. A status with no reason is the row support cannot explain.
ALTER TABLE organizations
  ADD COLUMN status_reason             text,
  ADD COLUMN status_changed_at         timestamptz,
  ADD COLUMN status_changed_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN organizations.status IS
  'active | trial | suspended (usually billing, reversible) | banned (for cause) | churned. suspended and banned both block tenant access.';
COMMENT ON COLUMN organizations.status_reason IS
  'Operator-supplied reason for the current status. Shown to the tenant on the blocked screen, so it is written for them to read.';

-- These three are entitlement-adjacent and operator-owned. 00037 revoked
-- table-level UPDATE from authenticated and re-granted a named column list, so
-- a column added now is NOT in that grant and is already unwritable. The
-- REVOKE is belt to that braces: it costs nothing and it survives anyone later
-- re-granting the table wholesale.
--
-- It is listed for anon too, but note that it does NOT take effect there: anon
-- still holds a TABLE-level UPDATE grant on organizations (a Supabase default
-- from before 00037), and a column-level revoke cannot subtract from a
-- table-level grant. anon is stopped by RLS instead — both organizations
-- policies resolve through auth.uid(), which anon does not have. Removing that
-- table grant is correct but is a change to pre-existing posture on a core
-- table, so it belongs in its own migration with its own signup testing, not
-- smuggled in here.
REVOKE UPDATE (status_reason, status_changed_at, status_changed_by_admin_id)
  ON organizations FROM anon, authenticated;


-- =============================================================================
-- 3. Blocked-tenant predicate
-- =============================================================================
--
-- One definition of "this tenant is locked out", so the web middleware, the
-- console and any future job all agree. Expressed as a function rather than
-- repeated as a status list, because the list will grow again.

CREATE OR REPLACE FUNCTION public.org_is_blocked(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT p_status IN ('suspended', 'banned') $$;

COMMENT ON FUNCTION public.org_is_blocked IS
  'Single definition of a locked-out tenant, shared by the customer middleware and the admin console.';
