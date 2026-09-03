-- =============================================================================
-- 00008_admin
--
-- Platform-operator tables. claude.md §6.8.
--
-- These are NOT tenant-scoped: they have no organization_id and are readable
-- only by the admin portal's service-role client. Customer-facing reads go
-- through the targeting helpers at the bottom, which resolve what a given org
-- should see without exposing the tables themselves.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Platform administrators
-- -----------------------------------------------------------------------------

CREATE TABLE admin_users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL UNIQUE,
  full_name    text NOT NULL,
  role         text NOT NULL DEFAULT 'support'
               CHECK (role IN ('superadmin', 'billing', 'support', 'readonly')),
  is_active    boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_users_email ON admin_users(email) WHERE is_active;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users
    WHERE user_id = auth.uid() AND is_active
  );
$$;

-- -----------------------------------------------------------------------------
-- Admin impersonation log
--
-- Every impersonation session is recorded before it starts and closed when it
-- ends (§13.11). This table is what makes support access accountable.
-- -----------------------------------------------------------------------------

CREATE TABLE admin_impersonations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason          text NOT NULL,
  ticket_ref      text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);

CREATE INDEX idx_admin_impersonations_org ON admin_impersonations(organization_id, started_at DESC);
CREATE INDEX idx_admin_impersonations_admin ON admin_impersonations(admin_user_id);

-- -----------------------------------------------------------------------------
-- System notices (shown to customers)
-- -----------------------------------------------------------------------------

CREATE TABLE system_notices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  body       text NOT NULL,
  type       text NOT NULL CHECK (type IN ('info', 'warning', 'critical', 'maintenance')),
  target     jsonb NOT NULL DEFAULT '{"scope": "all"}',
  starts_at  timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz,
  is_active  boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_notices_active ON system_notices(starts_at, ends_at) WHERE is_active;

-- -----------------------------------------------------------------------------
-- Announcements (in-app messaging)
-- -----------------------------------------------------------------------------

CREATE TABLE announcements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  body         text NOT NULL,
  display_type text NOT NULL
               CHECK (display_type IN ('modal', 'banner', 'notification', 'changelog')),
  target       jsonb NOT NULL DEFAULT '{"scope": "all"}',
  cta_text     text,
  cta_url      text,
  is_active    boolean NOT NULL DEFAULT true,
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_active ON announcements(starts_at, ends_at) WHERE is_active;

-- Tracks which users have dismissed which announcement, so a modal shows once.
CREATE TABLE announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Feature flags
-- -----------------------------------------------------------------------------

CREATE TABLE feature_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  description text,
  is_enabled  boolean NOT NULL DEFAULT false,
  rules       jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Targeting helpers
--
-- The customer app calls these instead of reading the admin tables directly, so
-- one org can never enumerate what another org is being shown.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.target_matches(target jsonb, org uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := target->>'scope';
  v_plan  text;
BEGIN
  IF v_scope = 'all' OR v_scope IS NULL THEN
    RETURN true;
  END IF;

  IF v_scope = 'orgs' THEN
    RETURN target->'org_ids' ? org::text;
  END IF;

  IF v_scope = 'plans' THEN
    SELECT p.name INTO v_plan
    FROM organizations o
    LEFT JOIN plans p ON p.id = o.plan_id
    WHERE o.id = org;
    RETURN v_plan IS NOT NULL AND target->'plans' ? v_plan;
  END IF;

  RETURN false;
END;
$$;

-- Notices the current tenant should see right now.
CREATE OR REPLACE FUNCTION public.active_notices_for_org(org uuid)
RETURNS SETOF system_notices
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM system_notices n
  WHERE n.is_active
    AND n.starts_at <= now()
    AND (n.ends_at IS NULL OR n.ends_at > now())
    AND public.target_matches(n.target, org)
  ORDER BY
    CASE n.type WHEN 'critical' THEN 0 WHEN 'warning' THEN 1
                WHEN 'maintenance' THEN 2 ELSE 3 END,
    n.starts_at DESC;
$$;

/*
 * Evaluate a feature flag for an organization.
 *
 * Rules are evaluated in order and the first match wins:
 *   { "type": "org",        "org_ids": [...] }
 *   { "type": "plan",       "plans": ["growth", "enterprise"] }
 *   { "type": "percentage", "value": 25 }
 *
 * The percentage bucket is a stable hash of flag key + org id, so an org's
 * bucket never flips between calls.
 */
CREATE OR REPLACE FUNCTION public.feature_enabled(flag_key text, org uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag    feature_flags%ROWTYPE;
  v_rule    jsonb;
  v_plan    text;
  v_bucket  integer;
BEGIN
  SELECT * INTO v_flag FROM feature_flags WHERE key = flag_key;

  IF NOT FOUND OR NOT v_flag.is_enabled THEN
    RETURN false;
  END IF;

  -- Enabled with no rules means enabled for everyone.
  IF jsonb_array_length(v_flag.rules) = 0 THEN
    RETURN true;
  END IF;

  SELECT p.name INTO v_plan
  FROM organizations o
  LEFT JOIN plans p ON p.id = o.plan_id
  WHERE o.id = org;

  FOR v_rule IN SELECT * FROM jsonb_array_elements(v_flag.rules) LOOP
    CASE v_rule->>'type'
      WHEN 'org' THEN
        IF v_rule->'org_ids' ? org::text THEN RETURN true; END IF;
      WHEN 'plan' THEN
        IF v_plan IS NOT NULL AND v_rule->'plans' ? v_plan THEN RETURN true; END IF;
      WHEN 'percentage' THEN
        v_bucket := abs(hashtext(flag_key || ':' || org::text)) % 100;
        IF v_bucket < (v_rule->>'value')::integer THEN RETURN true; END IF;
      ELSE
        NULL;
    END CASE;
  END LOOP;

  RETURN false;
END;
$$;

SELECT public.apply_updated_at_triggers();
