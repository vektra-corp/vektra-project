-- Who may create a workspace.
--
-- 00009 said "admins, full stop". The product needs "admins always, managers if
-- this organization says so" — delegation that an org opts into rather than a
-- permission the product decides for everyone.
--
-- The flag lives in `organizations.settings`, and this function is what makes
-- the RLS policy and the UI read the SAME fact. Putting the check only in the
-- server action would leave the database still refusing the insert, so a
-- manager would see the button, click it, and get an RLS error.

CREATE OR REPLACE FUNCTION public.can_create_workspace()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_org_role('admin')
    OR (
      public.has_org_role('manager')
      AND COALESCE(
        (
          SELECT (o.settings->>'managers_can_create_workspaces')::boolean
          FROM organizations o
          WHERE o.id = public.org_id()
        ),
        false   -- Absent or unparseable means "not delegated" (§2: fail closed).
      )
    );
$$;

COMMENT ON FUNCTION public.can_create_workspace() IS
  'True when the caller may create a workspace: an org admin, or a manager in an org that has delegated it via settings.managers_can_create_workspaces.';

REVOKE ALL ON FUNCTION public.can_create_workspace() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_workspace() TO authenticated;

DROP POLICY IF EXISTS "Admins create workspaces" ON workspaces;

CREATE POLICY "Permitted roles create workspaces" ON workspaces
  FOR INSERT WITH CHECK (
    organization_id = public.org_id() AND public.can_create_workspace()
  );

-- Updating and deleting stay admin-only. Delegating creation is a statement
-- about getting started, not about restructuring an org someone else set up.
