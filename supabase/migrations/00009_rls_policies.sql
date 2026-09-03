-- =============================================================================
-- 00009_rls_policies
--
-- Row-Level Security for every table created in 00001-00008. claude.md §7.
--
-- RLS is the primary security boundary; the RBAC checks in packages/auth are
-- defence-in-depth on top of it, never a substitute (§2, §22.4 layer 3).
--
-- Conventions used throughout:
--   * Tenant isolation is always `organization_id = public.org_id()`, never a
--     join through a parent table.
--   * Write policies additionally require a role via public.has_org_role().
--   * Portal users get their own explicitly-scoped policies. They hold no
--     org_role, so every staff policy already excludes them; their access comes
--     solely from portal_project_access (business rule 6).
--   * Fail closed: a table with RLS enabled and no matching policy denies.
-- =============================================================================

-- Profiles of people you share an organization with — needed to render
-- assignees, comment authors and member lists.
CREATE OR REPLACE FUNCTION public.shares_org_with(target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org_members a
    JOIN org_members b ON a.organization_id = b.organization_id
    WHERE a.user_id = auth.uid() AND b.user_id = target_user
  );
$$;

-- Does the current portal user reach this task / subtask / document?
CREATE OR REPLACE FUNCTION public.portal_can_access_task(t_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = t_id AND public.portal_can_access_project(t.project_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_can_comment_on_project(proj_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM portal_project_access ppa
    JOIN portal_users pu ON pu.id = ppa.portal_user_id
    WHERE ppa.project_id = proj_id
      AND pu.user_id = auth.uid()
      AND pu.status = 'active'
      AND ppa.can_comment
  );
$$;

-- =============================================================================
-- 00001 — Auth and tenancy
-- =============================================================================

-- --- plans -------------------------------------------------------------------
-- Public catalogue: the pricing page and plan picker read this. No tenant data.
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active plans" ON plans
  FOR SELECT USING (is_active);

-- --- organizations -----------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Membership rather than the JWT claim, so the org switcher can list every org
-- the user belongs to before a token refresh narrows it to one.
CREATE POLICY "Members see their organizations" ON organizations
  FOR SELECT USING (public.is_org_member(id));

CREATE POLICY "Owners can update their organization" ON organizations
  FOR UPDATE USING (id = public.org_id() AND public.has_org_role('owner'))
  WITH CHECK (id = public.org_id() AND public.has_org_role('owner'));

-- Organizations are created through a SECURITY DEFINER onboarding function
-- (create_organization), never by a direct client insert.

-- --- branches ----------------------------------------------------------------
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read branches" ON branches
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Admins manage branches" ON branches
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

-- --- profiles ----------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read profiles of org colleagues" ON profiles
  FOR SELECT USING (id = auth.uid() OR public.shares_org_with(id));

CREATE POLICY "Users update their own profile" ON profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- --- org_members -------------------------------------------------------------
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see the member list" ON org_members
  FOR SELECT USING (public.is_org_member(organization_id));

CREATE POLICY "Admins add members" ON org_members
  FOR INSERT WITH CHECK (
    organization_id = public.org_id()
    AND public.has_org_role('admin')
    AND role <> 'owner'
  );

CREATE POLICY "Admins update member roles" ON org_members
  FOR UPDATE USING (
    organization_id = public.org_id()
    AND public.has_org_role('admin')
    AND role <> 'owner'
  )
  WITH CHECK (
    organization_id = public.org_id()
    AND public.has_org_role('admin')
    AND role <> 'owner'
  );

CREATE POLICY "Admins remove members" ON org_members
  FOR DELETE USING (
    organization_id = public.org_id()
    AND public.has_org_role('admin')
    AND role <> 'owner'
  );

-- --- workspaces --------------------------------------------------------------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see workspaces in their org" ON workspaces
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Admins create workspaces" ON workspaces
  FOR INSERT WITH CHECK (
    organization_id = public.org_id() AND public.has_org_role('admin')
  );

CREATE POLICY "Admins update workspaces" ON workspaces
  FOR UPDATE USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

CREATE POLICY "Admins delete workspaces" ON workspaces
  FOR DELETE USING (organization_id = public.org_id() AND public.has_org_role('admin'));

-- --- workspace_members -------------------------------------------------------
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see workspace membership" ON workspace_members
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Admins manage workspace membership" ON workspace_members
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

-- --- roles (custom roles) ----------------------------------------------------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read roles" ON roles
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Admins manage roles" ON roles
  FOR ALL USING (
    organization_id = public.org_id() AND public.has_org_role('admin') AND NOT is_system
  )
  WITH CHECK (
    organization_id = public.org_id() AND public.has_org_role('admin') AND NOT is_system
  );

-- --- portal_users ------------------------------------------------------------
ALTER TABLE portal_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers see portal users" ON portal_users
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Portal users see their own record" ON portal_users
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Managers manage portal users" ON portal_users
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

-- --- user_sessions -----------------------------------------------------------
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own sessions" ON user_sessions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins see org sessions" ON user_sessions
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('admin'));

CREATE POLICY "Users revoke their own sessions" ON user_sessions
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins revoke org sessions" ON user_sessions
  FOR UPDATE USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

-- =============================================================================
-- 00002 — Project management
-- =============================================================================

-- --- projects ----------------------------------------------------------------
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see projects they can access" ON projects
  FOR SELECT USING (
    organization_id = public.org_id()
    AND (
      visibility = 'organization'
      OR public.is_workspace_member(workspace_id)
      OR public.is_project_member(id)
    )
  );

CREATE POLICY "Portal users see shared projects" ON projects
  FOR SELECT USING (public.portal_can_access_project(id));

CREATE POLICY "Managers create projects" ON projects
  FOR INSERT WITH CHECK (
    organization_id = public.org_id()
    AND public.has_org_role('manager')
    AND public.is_workspace_member(workspace_id)
  );

CREATE POLICY "Managers update projects" ON projects
  FOR UPDATE USING (
    organization_id = public.org_id()
    AND public.has_org_role('manager')
    AND (public.is_workspace_member(workspace_id) OR public.has_org_role('admin'))
  )
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Admins delete projects" ON projects
  FOR DELETE USING (organization_id = public.org_id() AND public.has_org_role('admin'));

-- --- project_members ---------------------------------------------------------
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see project membership" ON project_members
  FOR SELECT USING (
    organization_id = public.org_id() AND public.can_access_project(project_id)
  );

CREATE POLICY "Managers manage project membership" ON project_members
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

-- --- portal_project_access ---------------------------------------------------
ALTER TABLE portal_project_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers manage portal access" ON portal_project_access
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Portal users see their own grants" ON portal_project_access
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM portal_users pu
      WHERE pu.id = portal_project_access.portal_user_id AND pu.user_id = auth.uid()
    )
  );

-- --- kanban_boards -----------------------------------------------------------
ALTER TABLE kanban_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see boards" ON kanban_boards
  FOR SELECT USING (
    organization_id = public.org_id()
    AND (
      (project_id IS NOT NULL AND public.can_access_project(project_id))
      OR (task_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.id = kanban_boards.task_id AND public.can_access_project(t.project_id)))
    )
  );

CREATE POLICY "Managers manage boards" ON kanban_boards
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

-- --- kanban_columns ----------------------------------------------------------
ALTER TABLE kanban_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see columns" ON kanban_columns
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Managers manage columns" ON kanban_columns
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

-- --- labels ------------------------------------------------------------------
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see labels" ON labels
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Members manage labels" ON labels
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('member'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('member'));

-- --- tasks -------------------------------------------------------------------
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see tasks in accessible projects" ON tasks
  FOR SELECT USING (
    organization_id = public.org_id() AND public.can_access_project(project_id)
  );

CREATE POLICY "Portal users see tasks in shared projects" ON tasks
  FOR SELECT USING (public.portal_can_access_project(project_id));

CREATE POLICY "Members create tasks" ON tasks
  FOR INSERT WITH CHECK (
    organization_id = public.org_id() AND public.can_access_project(project_id)
  );

CREATE POLICY "Members update tasks" ON tasks
  FOR UPDATE USING (
    organization_id = public.org_id() AND public.can_access_project(project_id)
  )
  WITH CHECK (
    organization_id = public.org_id() AND public.can_access_project(project_id)
  );

CREATE POLICY "Managers delete tasks" ON tasks
  FOR DELETE USING (organization_id = public.org_id() AND public.has_org_role('manager'));

-- --- task_labels -------------------------------------------------------------
ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see task labels" ON task_labels
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Members manage task labels" ON task_labels
  FOR ALL USING (
    organization_id = public.org_id()
    AND EXISTS (SELECT 1 FROM tasks t
                WHERE t.id = task_labels.task_id AND public.can_access_project(t.project_id))
  )
  WITH CHECK (
    organization_id = public.org_id()
    AND EXISTS (SELECT 1 FROM tasks t
                WHERE t.id = task_labels.task_id AND public.can_access_project(t.project_id))
  );

-- --- subtasks ----------------------------------------------------------------
ALTER TABLE subtasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see subtasks" ON subtasks
  FOR SELECT USING (
    organization_id = public.org_id()
    AND EXISTS (SELECT 1 FROM tasks t
                WHERE t.id = subtasks.task_id AND public.can_access_project(t.project_id))
  );

CREATE POLICY "Portal users see subtasks in shared projects" ON subtasks
  FOR SELECT USING (public.portal_can_access_task(task_id));

CREATE POLICY "Members manage subtasks" ON subtasks
  FOR ALL USING (
    organization_id = public.org_id()
    AND EXISTS (SELECT 1 FROM tasks t
                WHERE t.id = subtasks.task_id AND public.can_access_project(t.project_id))
  )
  WITH CHECK (
    organization_id = public.org_id()
    AND EXISTS (SELECT 1 FROM tasks t
                WHERE t.id = subtasks.task_id AND public.can_access_project(t.project_id))
  );

-- --- task_dependencies -------------------------------------------------------
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see dependencies" ON task_dependencies
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Members manage dependencies" ON task_dependencies
  FOR ALL USING (
    organization_id = public.org_id()
    AND EXISTS (SELECT 1 FROM tasks t
                WHERE t.id = task_dependencies.predecessor_id
                  AND public.can_access_project(t.project_id))
  )
  WITH CHECK (
    organization_id = public.org_id()
    AND EXISTS (SELECT 1 FROM tasks t
                WHERE t.id = task_dependencies.predecessor_id
                  AND public.can_access_project(t.project_id))
  );

-- =============================================================================
-- 00003 — Collaboration
-- =============================================================================

-- --- documents ---------------------------------------------------------------
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see documents" ON documents
  FOR SELECT USING (
    organization_id = public.org_id() AND public.can_access_project(project_id)
  );

CREATE POLICY "Portal users see published documents" ON documents
  FOR SELECT USING (
    status = 'published' AND public.portal_can_access_project(project_id)
  );

CREATE POLICY "Members manage documents" ON documents
  FOR ALL USING (
    organization_id = public.org_id() AND public.can_access_project(project_id)
  )
  WITH CHECK (
    organization_id = public.org_id() AND public.can_access_project(project_id)
  );

-- --- document_versions -------------------------------------------------------
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read document history" ON document_versions
  FOR SELECT USING (
    organization_id = public.org_id()
    AND EXISTS (SELECT 1 FROM documents d
                WHERE d.id = document_versions.document_id
                  AND public.can_access_project(d.project_id))
  );

-- Versions are written by the snapshot trigger, which runs as the table owner.

-- --- comments ----------------------------------------------------------------
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see comments" ON comments
  FOR SELECT USING (organization_id = public.org_id());

-- Portal users never see internal comments, and only on projects shared with them.
CREATE POLICY "Portal users see external comments" ON comments
  FOR SELECT USING (
    is_internal = false
    AND (
      (task_id IS NOT NULL AND public.portal_can_access_task(task_id))
      OR (document_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM documents d
            WHERE d.id = comments.document_id
              AND public.portal_can_access_project(d.project_id)))
    )
  );

CREATE POLICY "Members write comments" ON comments
  FOR INSERT WITH CHECK (
    organization_id = public.org_id() AND author_id = auth.uid()
  );

CREATE POLICY "Portal users write external comments" ON comments
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND is_internal = false
    AND task_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = comments.task_id AND public.portal_can_comment_on_project(t.project_id)
    )
  );

CREATE POLICY "Authors edit their own comments" ON comments
  FOR UPDATE USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Authors and managers delete comments" ON comments
  FOR DELETE USING (
    author_id = auth.uid()
    OR (organization_id = public.org_id() AND public.has_org_role('manager'))
  );

-- --- attachments -------------------------------------------------------------
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see attachments" ON attachments
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Portal users see attachments on shared tasks" ON attachments
  FOR SELECT USING (
    task_id IS NOT NULL AND public.portal_can_access_task(task_id)
  );

CREATE POLICY "Members upload attachments" ON attachments
  FOR INSERT WITH CHECK (
    organization_id = public.org_id() AND uploaded_by = auth.uid()
  );

CREATE POLICY "Uploaders and managers delete attachments" ON attachments
  FOR DELETE USING (
    uploaded_by = auth.uid()
    OR (organization_id = public.org_id() AND public.has_org_role('manager'))
  );

-- =============================================================================
-- 00004 — Commercial
--
-- Commercial data is manager-and-above only (§7). Members see nothing here.
-- =============================================================================

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read contacts" ON contacts
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Managers manage contacts" ON contacts
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

ALTER TABLE pdf_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read templates" ON pdf_templates
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Admins manage templates" ON pdf_templates
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

-- Sequences are only touched by next_doc_number(), which is SECURITY DEFINER.
ALTER TABLE commercial_doc_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read numbering config" ON commercial_doc_sequences
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('admin'));

CREATE POLICY "Admins configure numbering" ON commercial_doc_sequences
  FOR UPDATE USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE commercial_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read commercial documents" ON commercial_documents
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Managers create commercial documents" ON commercial_documents
  FOR INSERT WITH CHECK (
    organization_id = public.org_id() AND public.has_org_role('manager')
  );

CREATE POLICY "Managers update commercial documents" ON commercial_documents
  FOR UPDATE USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Admins delete commercial documents" ON commercial_documents
  FOR DELETE USING (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE commercial_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read line items" ON commercial_line_items
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Managers manage line items" ON commercial_line_items
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

ALTER TABLE approval_chains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read approval chains" ON approval_chains
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Admins manage approval chains" ON approval_chains
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE approval_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read approval steps" ON approval_steps
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('manager'));

CREATE POLICY "Managers record approvals" ON approval_steps
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

-- =============================================================================
-- 00005 — Workflows
-- =============================================================================

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read workflows" ON workflows
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Managers manage workflows" ON workflows
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('manager'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('manager'));

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read workflow runs" ON workflow_runs
  FOR SELECT USING (organization_id = public.org_id());

ALTER TABLE workflow_step_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read workflow step logs" ON workflow_step_logs
  FOR SELECT USING (organization_id = public.org_id());

-- Runs and step logs are written by the engine using the service role.

-- =============================================================================
-- 00006 — Integrations
-- =============================================================================

-- No SELECT policy exposes the token columns to end users. The admin UI reads
-- provider/status/config through a view; the tokens themselves are only ever
-- read by an Edge Function using the service role (§13.10).
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage integrations" ON integrations
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

-- Column-level revoke for the token columns is applied at the end of this file,
-- after the blanket table grants.

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage webhook endpoints" ON webhook_endpoints
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read webhook deliveries" ON webhook_deliveries
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('admin'));

-- =============================================================================
-- 00007 — Platform
-- =============================================================================

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their org usage" ON usage_counters
  FOR SELECT USING (organization_id = public.org_id());

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own notifications" ON notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users mark their notifications read" ON notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete their own notifications" ON notifications
  FOR DELETE USING (user_id = auth.uid());

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their notification preferences" ON notification_preferences
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND organization_id = public.org_id());

-- --- audit_logs (business rule 5: append-only) -------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit logs" ON audit_logs
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('admin'));

CREATE POLICY "Members append audit entries" ON audit_logs
  FOR INSERT WITH CHECK (organization_id = public.org_id());

-- Deliberately no UPDATE or DELETE policy. See also the audit_logs_immutable
-- trigger in 00007, which blocks even a privileged caller.

-- --- events ------------------------------------------------------------------
-- Event payloads carry full row snapshots, including fields a member may not be
-- entitled to see. Restricted to admins; the engine reads them via service role.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read events" ON events
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read custom fields" ON custom_fields
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Admins manage custom fields" ON custom_fields
  FOR ALL USING (organization_id = public.org_id() AND public.has_org_role('admin'))
  WITH CHECK (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read custom field values" ON custom_field_values
  FOR SELECT USING (organization_id = public.org_id());

CREATE POLICY "Members write custom field values" ON custom_field_values
  FOR ALL USING (organization_id = public.org_id())
  WITH CHECK (organization_id = public.org_id());

ALTER TABLE import_export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own jobs" ON import_export_jobs
  FOR SELECT USING (
    organization_id = public.org_id()
    AND (started_by = auth.uid() OR public.has_org_role('admin'))
  );

CREATE POLICY "Members start jobs" ON import_export_jobs
  FOR INSERT WITH CHECK (
    organization_id = public.org_id() AND started_by = auth.uid()
  );

-- =============================================================================
-- 00008 — Admin portal tables
--
-- No customer-facing policies. The admin portal uses the service role, which
-- bypasses RLS; enabling RLS with only an admin policy means a leaked anon or
-- authenticated key still reads nothing.
-- =============================================================================

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read admin users" ON admin_users
  FOR SELECT USING (public.is_platform_admin());

ALTER TABLE admin_impersonations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read impersonations" ON admin_impersonations
  FOR SELECT USING (public.is_platform_admin());

-- Customers can see impersonation of their own org — support access is visible
-- to the tenant it touched.
CREATE POLICY "Org admins see impersonation of their org" ON admin_impersonations
  FOR SELECT USING (organization_id = public.org_id() AND public.has_org_role('admin'));

ALTER TABLE system_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage notices" ON system_notices
  FOR ALL USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage announcements" ON announcements
  FOR ALL USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Customers reach notices and announcements through active_notices_for_org()
-- and feature_enabled(), which are SECURITY DEFINER and filter by targeting.

ALTER TABLE announcement_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own dismissals" ON announcement_dismissals
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage feature flags" ON feature_flags
  FOR ALL USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- =============================================================================
-- Storage buckets and policies (§13.9)
--
-- Every object path starts with the org id, so the first path segment is the
-- tenant boundary: /{org_id}/attachments/{uuid}/{filename}
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('attachments', 'attachments', false, 104857600, NULL),
  ('avatars',     'avatars',     false, 5242880,
   ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('logos',       'logos',       false, 5242880,
   ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- Attachments: readable and writable only within your own tenant folder.
CREATE POLICY "Tenant reads its own attachments" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.org_id()::text
  );

CREATE POLICY "Tenant uploads its own attachments" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.org_id()::text
  );

CREATE POLICY "Tenant deletes its own attachments" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.org_id()::text
  );

-- Avatars are keyed by user id rather than org, since a user may belong to many.
CREATE POLICY "Users read avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Users write their own avatar" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users replace their own avatar" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Tenant reads its own logo" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'logos' AND (storage.foldername(name))[1] = public.org_id()::text
  );

CREATE POLICY "Admins write the org logo" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = public.org_id()::text
    AND public.has_org_role('admin')
  );

-- =============================================================================
-- Table privileges
--
-- RLS filters WHICH ROWS a role may touch; it does nothing until the role also
-- holds the underlying table privilege. Supabase's bootstrap sets default
-- privileges that would cover this implicitly, but stating it here keeps the
-- schema portable and makes the grant surface auditable in one place.
--
-- Order matters: the blanket grants come first, then the targeted revokes.
-- =============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Authenticated users get full DML; every table's RLS decides what that reaches.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Anonymous callers see the plan catalogue and nothing else: it is the only
-- table the signed-out pricing page needs.
GRANT SELECT ON plans TO anon;

-- Anything created later inherits the same shape.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
-- --- Targeted column and table restrictions ----------------------------------
--
-- IMPORTANT: a column-level REVOKE does nothing while the role still holds the
-- table-level privilege. Postgres checks the table grant first and, finding it,
-- never consults per-column grants. The only way to protect individual columns
-- is to withhold the table-level privilege and grant the permitted columns
-- explicitly, which is what grant_columns_except() below does.

CREATE OR REPLACE FUNCTION public.grant_columns_except(
  p_table     text,
  p_privilege text,
  p_except    text[],
  p_role      text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_cols text;
BEGIN
  -- Only these privileges are column-scoped in Postgres; anything else is a bug
  -- in the caller, not a value to interpolate.
  IF p_privilege NOT IN ('SELECT', 'INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'grant_columns_except supports SELECT/INSERT/UPDATE, got %', p_privilege;
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = p_table
    AND NOT (column_name = ANY (p_except));

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'No grantable columns left on %', p_table;
  END IF;

  EXECUTE format('REVOKE %s ON public.%I FROM %I', p_privilege, p_table, p_role);
  EXECUTE format('GRANT %s (%s) ON public.%I TO %I', p_privilege, v_cols, p_table, p_role);
END;
$$;

COMMENT ON FUNCTION public.grant_columns_except IS
  'Grants a column-scoped privilege on every column except the listed ones, after dropping the table-wide grant that would otherwise override it.';

-- Business rule 5: audit logs are append-only. Table-level, so a plain REVOKE
-- is the right tool here.
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;

-- Events carry whole-row snapshots; only the service role writes them.
REVOKE INSERT, UPDATE, DELETE ON events FROM authenticated, anon;

-- Usage counters move only through increment_usage().
REVOKE INSERT, UPDATE, DELETE ON usage_counters FROM authenticated, anon;

-- Numbering counters move only through next_doc_number().
REVOKE INSERT, DELETE ON commercial_doc_sequences FROM authenticated, anon;

-- Workflow execution records are written by the engine, not by users.
REVOKE INSERT, UPDATE, DELETE ON workflow_runs, workflow_step_logs FROM authenticated, anon;

-- Document history is written by the snapshot trigger.
REVOKE INSERT, UPDATE, DELETE ON document_versions FROM authenticated, anon;

-- Platform-operator tables: no end-user session touches these at all.
REVOKE ALL ON admin_users, admin_impersonations, system_notices,
              announcements, feature_flags
  FROM authenticated, anon;
GRANT SELECT ON announcements, system_notices TO authenticated;

-- --- Column-scoped restrictions ----------------------------------------------

DO $$
BEGIN
  -- OAuth tokens are never readable or writable by an end-user session, not even
  -- an org admin's. They are decrypted only inside an Edge Function running as
  -- the service role (§13.10).
  PERFORM public.grant_columns_except(
    'integrations', 'SELECT', ARRAY['access_token', 'refresh_token'], 'authenticated');
  PERFORM public.grant_columns_except(
    'integrations', 'UPDATE', ARRAY['access_token', 'refresh_token'], 'authenticated');
  PERFORM public.grant_columns_except(
    'integrations', 'INSERT', ARRAY['access_token', 'refresh_token'], 'authenticated');

  -- Business rule 1: task numbers are assigned by trigger and never rewritten.
  PERFORM public.grant_columns_except('tasks', 'UPDATE', ARRAY['task_number'], 'authenticated');

  -- The per-project counter behind those numbers is equally off limits.
  PERFORM public.grant_columns_except(
    'projects', 'UPDATE', ARRAY['last_task_number'], 'authenticated');

  -- Money totals are derived from the line items by trigger.
  PERFORM public.grant_columns_except(
    'commercial_documents', 'UPDATE',
    ARRAY['subtotal', 'tax_total', 'discount_total', 'grand_total'], 'authenticated');

  PERFORM public.grant_columns_except(
    'commercial_line_items', 'UPDATE', ARRAY['line_total'], 'authenticated');
END $$;

-- The anon role holds nothing beyond the plan catalogue, so no column work is
-- needed for it.
