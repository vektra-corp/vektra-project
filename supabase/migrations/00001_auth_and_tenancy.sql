-- =============================================================================
-- 00001_auth_and_tenancy
--
-- Extensions, shared utility functions, and the tenancy spine:
--   plans -> organizations -> workspaces -> members
--
-- claude.md §6.1, §6.9. Every tenant-scoped table carries organization_id so
-- RLS never has to join through a parent table (§2).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid, encryption for OAuth tokens (§13.10)
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- Trigram indexes for name/title search
CREATE EXTENSION IF NOT EXISTS btree_gist;    -- Exclusion constraints (single running timer, leave overlap)

-- -----------------------------------------------------------------------------
-- Utility: updated_at maintenance
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Attach the updated_at trigger to every public table that has the column.
-- Idempotent, so each migration can call it after adding tables.
CREATE OR REPLACE FUNCTION public.apply_updated_at_triggers()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.column_name = 'updated_at'
      AND c.table_schema = 'public'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', t);
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- Plans (subscription tiers)
--
-- Lives here rather than in 00007_platform because organizations.plan_id
-- references it. Contents are seeded in supabase/seed.sql and mirrored by
-- packages/shared/src/constants/plans.ts.
-- -----------------------------------------------------------------------------

CREATE TABLE plans (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL UNIQUE
                          CHECK (name IN ('starter', 'growth', 'enterprise')),
  display_name            text NOT NULL,
  stripe_price_id_monthly text,
  stripe_price_id_annual  text,
  limits                  jsonb NOT NULL DEFAULT '{}',
  features                jsonb NOT NULL DEFAULT '{}',
  sort_order              integer NOT NULL DEFAULT 0,
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE plans IS 'Subscription tiers. limits/features mirror PLAN_LIMITS in @pm/shared.';

-- -----------------------------------------------------------------------------
-- Organizations (top-level tenant)
-- -----------------------------------------------------------------------------

CREATE TABLE organizations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL CHECK (length(trim(name)) > 0),
  slug                   text NOT NULL UNIQUE
                         CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$'),
  logo_url               text,
  address                jsonb,          -- { street, city, state, zip, country }
  billing_email          text,
  tax_id                 text,
  currency               text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  timezone               text NOT NULL DEFAULT 'UTC',
  settings               jsonb NOT NULL DEFAULT '{}',  -- locale, MFA enforcement, session timeout
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text UNIQUE,
  plan_id                uuid REFERENCES plans(id),
  trial_ends_at          timestamptz,
  status                 text NOT NULL DEFAULT 'trial'
                         CHECK (status IN ('active', 'trial', 'suspended', 'churned')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_stripe ON organizations(stripe_customer_id);
CREATE INDEX idx_organizations_status ON organizations(status);

-- -----------------------------------------------------------------------------
-- Branches (optional sub-divisions within an org)
-- -----------------------------------------------------------------------------

CREATE TABLE branches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  location        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX idx_branches_org ON branches(organization_id);

-- -----------------------------------------------------------------------------
-- Profiles (extends auth.users)
-- -----------------------------------------------------------------------------

CREATE TABLE profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text NOT NULL DEFAULT '',
  avatar_url text,
  phone      text,
  timezone   text DEFAULT 'UTC',
  settings   jsonb NOT NULL DEFAULT '{}',   -- locale, date_format, time_format, theme
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_name ON profiles USING gin (full_name gin_trgm_ops);

-- Create a profile automatically for every new auth user, so no code path can
-- produce a user without one.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1),
      ''
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Org members
-- -----------------------------------------------------------------------------

CREATE TABLE org_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner', 'admin', 'manager', 'member')),
  branch_id       uuid REFERENCES branches(id) ON DELETE SET NULL,
  is_default      boolean NOT NULL DEFAULT false,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org ON org_members(organization_id);

-- Exactly one org per organization may hold the owner role.
CREATE UNIQUE INDEX idx_org_members_single_owner
  ON org_members(organization_id) WHERE role = 'owner';

-- A user has at most one default org — this is what custom_access_token_hook reads.
CREATE UNIQUE INDEX idx_org_members_single_default
  ON org_members(user_id) WHERE is_default;

-- -----------------------------------------------------------------------------
-- Workspaces
-- -----------------------------------------------------------------------------

CREATE TABLE workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$'),
  description     text,
  color           text,
  icon            text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX idx_workspaces_org ON workspaces(organization_id);

CREATE TABLE workspace_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin', 'member', 'viewer')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_org ON workspace_members(organization_id);

-- -----------------------------------------------------------------------------
-- Custom roles (Enterprise tier)
-- -----------------------------------------------------------------------------

CREATE TABLE roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  is_system       boolean NOT NULL DEFAULT false,
  permissions     jsonb NOT NULL DEFAULT '{}',   -- { "projects.create": true, ... }
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX idx_roles_org ON roles(organization_id);

-- -----------------------------------------------------------------------------
-- Portal users (external access)
-- -----------------------------------------------------------------------------

CREATE TABLE portal_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           text NOT NULL,
  full_name       text NOT NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited', 'active', 'disabled')),
  invited_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE INDEX idx_portal_users_org ON portal_users(organization_id);
CREATE INDEX idx_portal_users_user ON portal_users(user_id);

-- -----------------------------------------------------------------------------
-- Sessions (§13.6 — users can view and revoke their own; admins can force-revoke)
-- -----------------------------------------------------------------------------

CREATE TABLE user_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  device          text,
  ip_address      inet,
  user_agent      text,
  -- SHA-256 of ip|user-agent. Flagged when it changes mid-session (§13.6).
  fingerprint     text,
  last_active_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_sessions_org ON user_sessions(organization_id);

-- -----------------------------------------------------------------------------
-- Auth helper functions used by every RLS policy (§7)
--
-- These read the JWT only. They are STABLE and cheap, so a policy that calls
-- public.org_id() costs nothing per row.
--
-- DEVIATION FROM claude.md §7: the spec names these auth.org_id() and
-- auth.org_role(). That cannot work on hosted Supabase — the `auth` schema is
-- owned by supabase_admin and a project's postgres role has no CREATE on it, so
-- the migration dies with "permission denied for schema auth". It only appeared
-- to work locally because the local stack runs as a superuser. They live in
-- `public` instead, which is also what Supabase's own RBAC guidance recommends.
-- auth.uid() and auth.jwt() are Supabase built-ins and are still called directly.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.org_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'org_id', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.org_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'org_role', '');
$$;

COMMENT ON FUNCTION public.org_id() IS
  'Current tenant from the JWT org_id claim, injected by custom_access_token_hook.';

-- Membership helpers. SECURITY DEFINER so a policy on `projects` can read
-- `workspace_members` without needing its own SELECT policy to pass first —
-- which would otherwise recurse.
CREATE OR REPLACE FUNCTION public.is_org_member(org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE organization_id = org AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$;

-- Effective org role for the current user, preferring the live membership row
-- over the JWT claim so a role change takes effect without a token refresh.
CREATE OR REPLACE FUNCTION public.current_org_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM org_members
  WHERE organization_id = public.org_id() AND user_id = auth.uid();
$$;

-- Rank comparison used by policies that need "manager or above".
CREATE OR REPLACE FUNCTION public.has_org_role(minimum text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    array_position(ARRAY['member','manager','admin','owner'], public.current_org_role())
      >= array_position(ARRAY['member','manager','admin','owner'], minimum),
    false
  );
$$;

-- True when the caller is an external portal user rather than a staff member.
CREATE OR REPLACE FUNCTION public.is_portal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM portal_users
    WHERE user_id = auth.uid() AND status = 'active'
  );
$$;

-- -----------------------------------------------------------------------------
-- Custom JWT claims hook (§6.9)
--
-- Registered in supabase/config.toml. Injects org_id and org_role so RLS can
-- read the tenant straight from the token.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims   jsonb;
  v_org_id uuid;
  v_role   text;
BEGIN
  claims := event->'claims';

  SELECT om.organization_id, om.role
    INTO v_org_id, v_role
  FROM public.org_members om
  WHERE om.user_id = (event->>'user_id')::uuid
  ORDER BY om.is_default DESC, om.joined_at ASC
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(v_role));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON TABLE public.org_members TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;

-- -----------------------------------------------------------------------------
-- Onboarding
--
-- There is deliberately no INSERT policy on `organizations`: a tenant must not
-- be creatable by an arbitrary client write, because the same statement has to
-- also create the owner membership and the first workspace or it leaves an
-- orphaned org nobody can reach. This function is the only way in, and it does
-- all of it in one transaction.
-- -----------------------------------------------------------------------------

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
  VALUES (p_name, p_slug, p_timezone, p_currency, 'trial', v_plan, now() + interval '14 days')
  RETURNING * INTO v_org;

  -- A user has exactly one default org; the newest becomes it.
  UPDATE org_members SET is_default = false WHERE user_id = v_user AND is_default;

  INSERT INTO org_members (organization_id, user_id, role, is_default)
  VALUES (v_org.id, v_user, 'owner', true);

  INSERT INTO workspaces (organization_id, name, slug, description, created_by)
  VALUES (v_org.id, 'General', 'general', 'Default workspace', v_user)
  RETURNING id INTO v_ws;

  INSERT INTO workspace_members (workspace_id, user_id, organization_id, role)
  VALUES (v_ws, v_user, v_org.id, 'admin');

  RETURN v_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_organization(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, text) TO authenticated;

/* Is a slug free? Used by the onboarding form for live availability. */
CREATE OR REPLACE FUNCTION public.slug_available(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM organizations WHERE slug = p_slug);
$$;

SELECT public.apply_updated_at_triggers();
