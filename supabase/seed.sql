-- =============================================================================
-- Development seed data
--
-- Applied by `supabase db reset`. Two organizations exist deliberately: Acme and
-- Globex. They are the fixture the RLS isolation tests use to prove a user in
-- one tenant cannot reach the other (claude.md §14).
--
-- Never run against staging or production.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Plans — mirrors PLAN_LIMITS in packages/shared/src/constants/plans.ts
-- -----------------------------------------------------------------------------

INSERT INTO plans (name, display_name, sort_order, limits, features) VALUES
(
  'starter', 'Starter', 1,
  '{"projects": 10, "storage_bytes": 1073741824, "max_file_size_bytes": 10485760,
    "portal_users": 0, "workflows_per_workspace": 3, "workflow_runs_per_month": 500,
    "documents_per_project": 5}'::jsonb,
  '{"custom_fields": false, "custom_tables": false, "gantt": false,
    "subtask_kanban": false, "commercial": false, "custom_roles": false,
    "api_access": false}'::jsonb
),
(
  'growth', 'Growth', 2,
  '{"projects": null, "storage_bytes": 10737418240, "max_file_size_bytes": 52428800,
    "portal_users": 5, "workflows_per_workspace": 20, "workflow_runs_per_month": 5000,
    "documents_per_project": null}'::jsonb,
  '{"custom_fields": true, "custom_tables": false, "gantt": true,
    "subtask_kanban": true, "commercial": true, "custom_roles": false,
    "api_access": false}'::jsonb
),
(
  'enterprise', 'Enterprise', 3,
  '{"projects": null, "storage_bytes": null, "max_file_size_bytes": 104857600,
    "portal_users": null, "workflows_per_workspace": null,
    "workflow_runs_per_month": 50000, "documents_per_project": null}'::jsonb,
  '{"custom_fields": true, "custom_tables": true, "gantt": true,
    "subtask_kanban": true, "commercial": true, "custom_roles": true,
    "api_access": true}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Feature flags
-- -----------------------------------------------------------------------------

INSERT INTO feature_flags (key, description, is_enabled, rules) VALUES
  ('gantt_chart', 'Timeline / Gantt view', true,
   '[{"type": "plan", "plans": ["growth", "enterprise"]}]'::jsonb),
  ('subtask_kanban', 'Kanban board inside a task', true,
   '[{"type": "plan", "plans": ["growth", "enterprise"]}]'::jsonb),
  ('workflow_builder', 'Visual workflow editor', true,
   '[{"type": "plan", "plans": ["growth", "enterprise"]}]'::jsonb),
  ('commercial_docs', 'Quotations', true,
   '[{"type": "plan", "plans": ["growth", "enterprise"]}]'::jsonb),
  ('ai_chat', 'AI assistant', false, '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Test users
--
-- Password for all seeded accounts: "password123"
-- The hash below is bcrypt of that string; it is a local fixture only.
-- -----------------------------------------------------------------------------

-- GoTrue scans confirmation_token, recovery_token, email_change_token_new and
-- email_change into non-nullable Go strings. Those four columns are nullable
-- with no default, so leaving them NULL makes every login fail with
-- "Database error querying schema". They must be empty strings, not NULL.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email,
  crypt('password123', gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(),
  '', '', '', ''
FROM (VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'owner@acme.test',      'Ada Owner'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'manager@acme.test',    'Mo Manager'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'member@acme.test',     'Mia Member'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'owner@globex.test',    'Gus Globex'),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'client@external.test', 'Pat Portal')
) AS u(id, email, full_name)
ON CONFLICT (id) DO NOTHING;

-- A normal signup also creates an identity row for the email provider. Without
-- it the account exists but behaves oddly on identity linking and re-auth.
INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true,
                     'phone_verified', false),
  'email', now(), now(), now()
FROM auth.users u
WHERE u.email IN ('owner@acme.test', 'manager@acme.test', 'member@acme.test',
                  'owner@globex.test', 'client@external.test')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Organizations
-- -----------------------------------------------------------------------------

INSERT INTO organizations (id, name, slug, currency, timezone, status, plan_id, settings) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Acme Corp', 'acme', 'USD', 'America/New_York',
   'active', (SELECT id FROM plans WHERE name = 'growth'),
   '{"locale": "en", "date_format": "MM/DD/YYYY", "time_format": "12h"}'::jsonb),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Globex Ltd', 'globex', 'GBP', 'Europe/London',
   'active', (SELECT id FROM plans WHERE name = 'starter'),
   '{"locale": "en", "date_format": "DD/MM/YYYY", "time_format": "24h"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org_members (organization_id, user_id, role, is_default) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner',   true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'manager', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member',  true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', 'owner',   true)
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Workspaces
-- -----------------------------------------------------------------------------

INSERT INTO workspaces (id, organization_id, name, slug, description, created_by) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Engineering', 'engineering', 'Product and platform work',
   '11111111-1111-1111-1111-111111111111'),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Operations', 'operations', 'Delivery and back office',
   '11111111-1111-1111-1111-111111111111'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Main', 'main', 'Default workspace',
   '44444444-4444-4444-4444-444444444444')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, organization_id, role) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'),
  ('a1a1a1a1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member'),
  ('a1a1a1a1-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member'),
  ('a1a1a1a1-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'),
  ('b1b1b1b1-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Projects (the default board and its four columns are created by trigger)
-- -----------------------------------------------------------------------------

INSERT INTO projects (id, organization_id, workspace_id, name, description, status,
                      priority, start_date, end_date, visibility, created_by) VALUES
  ('a2a2a2a2-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', 'Website Redesign',
   'Marketing site rebuild', 'active', 'high',
   CURRENT_DATE - 14, CURRENT_DATE + 45, 'workspace',
   '11111111-1111-1111-1111-111111111111'),
  ('a2a2a2a2-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', 'Mobile App',
   'iOS and Android client', 'active', 'critical',
   CURRENT_DATE - 30, CURRENT_DATE + 90, 'organization',
   '11111111-1111-1111-1111-111111111111'),
  ('b2b2b2b2-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b1b1b1b1-0000-0000-0000-000000000001', 'Globex Internal Tool',
   'Should never be visible to Acme users', 'active', 'medium',
   CURRENT_DATE, CURRENT_DATE + 60, 'workspace',
   '44444444-4444-4444-4444-444444444444')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_members (project_id, user_id, organization_id, role) VALUES
  ('a2a2a2a2-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
  ('a2a2a2a2-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contributor'),
  ('a2a2a2a2-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contributor'),
  ('a2a2a2a2-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
  ('b2b2b2b2-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner')
ON CONFLICT (project_id, user_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Labels
-- -----------------------------------------------------------------------------

INSERT INTO labels (id, organization_id, project_id, name, color) VALUES
  ('a3a3a3a3-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   NULL, 'Bug', '#EF4444'),
  ('a3a3a3a3-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   NULL, 'Feature', '#3B82F6'),
  ('a3a3a3a3-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   NULL, 'Design', '#A855F7')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Tasks (task_number is assigned by trigger)
-- -----------------------------------------------------------------------------

INSERT INTO tasks (organization_id, project_id, kanban_column_id, title, status, priority,
                   assignee_id, assigner_id, start_date, due_date, estimated_hours,
                   position, created_by)
SELECT
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'a2a2a2a2-0000-0000-0000-000000000001',
  (SELECT c.id FROM kanban_columns c
     JOIN kanban_boards b ON b.id = c.board_id
    WHERE b.project_id = 'a2a2a2a2-0000-0000-0000-000000000001' AND c.status = t.status),
  t.title, t.status, t.priority,
  t.assignee::uuid, '22222222-2222-2222-2222-222222222222',
  CURRENT_DATE - t.offset_days, CURRENT_DATE + t.due_in, t.hours, t.pos,
  '22222222-2222-2222-2222-222222222222'
FROM (VALUES
  ('Audit current site performance', 'done',        'high',     '33333333-3333-3333-3333-333333333333', 12, -2, 8.0,  0),
  ('Design new homepage',            'in_progress', 'critical', '33333333-3333-3333-3333-333333333333', 6,   5, 24.0, 0),
  ('Rewrite pricing page copy',      'in_review',   'medium',   '22222222-2222-2222-2222-222222222222', 3,   2, 6.0,  0),
  ('Set up analytics',               'todo',        'low',      NULL,                                   0,  14, 4.0,  0),
  ('Migrate blog content',           'todo',        'medium',   '33333333-3333-3333-3333-333333333333', 0,  21, 16.0, 1)
) AS t(title, status, priority, assignee, offset_days, due_in, hours, pos);

INSERT INTO tasks (organization_id, project_id, title, status, priority, created_by)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2b2b2b2-0000-0000-0000-000000000001',
        'Globex secret task', 'todo', 'high', '44444444-4444-4444-4444-444444444444');

-- Subtasks on the in-progress design task
INSERT INTO subtasks (organization_id, task_id, title, status, priority, assignee_id, position)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', t.id, s.title, s.status, 'medium',
       '33333333-3333-3333-3333-333333333333', s.pos
FROM tasks t
CROSS JOIN (VALUES
  ('Wireframe hero section', 'done',        0),
  ('Pick type scale',        'in_progress', 1),
  ('Dark mode palette',      'todo',        2)
) AS s(title, status, pos)
WHERE t.project_id = 'a2a2a2a2-0000-0000-0000-000000000001'
  AND t.title = 'Design new homepage';

-- Globex gets its own labels and subtasks too. The RLS isolation tests assert
-- that each tenant sees a strict subset of every table, which proves nothing if
-- one side is empty.
INSERT INTO labels (organization_id, project_id, name, color) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'Internal', '#0EA5E9'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'Urgent',   '#DC2626');

INSERT INTO subtasks (organization_id, task_id, title, status, priority, position)
SELECT 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', t.id, s.title, s.status, 'medium', s.pos
FROM tasks t
CROSS JOIN (VALUES
  ('Draft the internal spec', 'todo',        0),
  ('Review with legal',       'in_progress', 1)
) AS s(title, status, pos)
WHERE t.project_id = 'b2b2b2b2-0000-0000-0000-000000000001';

-- -----------------------------------------------------------------------------
-- Portal user with access to exactly one Acme project
-- -----------------------------------------------------------------------------

INSERT INTO portal_users (id, organization_id, email, full_name, user_id, status, invited_by)
VALUES ('a4a4a4a4-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'client@external.test', 'Pat Portal', '55555555-5555-5555-5555-555555555555',
        'active', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO portal_project_access (portal_user_id, project_id, organization_id, can_comment, granted_by)
VALUES ('a4a4a4a4-0000-0000-0000-000000000001', 'a2a2a2a2-0000-0000-0000-000000000001',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true,
        '11111111-1111-1111-1111-111111111111')
ON CONFLICT (portal_user_id, project_id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Documents
--
-- One published and one draft in Acme, so the portal policy (published only)
-- has both cases to discriminate between, plus one in Globex for isolation.
-- -----------------------------------------------------------------------------

INSERT INTO documents (id, organization_id, project_id, title, content, status, created_by) VALUES
('a5a5a5a5-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 'a2a2a2a2-0000-0000-0000-000000000001', 'Acme published spec',
 '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Visible to the portal."}]}]}'::jsonb,
 'published', '11111111-1111-1111-1111-111111111111'),
('a5a5a5a5-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 'a2a2a2a2-0000-0000-0000-000000000001', 'Acme internal draft',
 '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Internal only."}]}]}'::jsonb,
 'draft', '11111111-1111-1111-1111-111111111111'),
('b5b5b5b5-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
 'b2b2b2b2-0000-0000-0000-000000000001', 'Globex spec',
 '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Other tenant."}]}]}'::jsonb,
 'published', '44444444-4444-4444-4444-444444444444')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Employees and leave
--
-- Acme has a manager and a member so the "read your own balance, or anyone's if
-- you manage people" policy has both sides. Globex has one, for isolation.
-- -----------------------------------------------------------------------------

INSERT INTO employees (id, organization_id, user_id, employee_code, department,
                       date_of_joining, status) VALUES
('a6a6a6a6-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '22222222-2222-2222-2222-222222222222', 'ACME-002', 'Delivery', '2024-02-01', 'active'),
('a6a6a6a6-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '33333333-3333-3333-3333-333333333333', 'ACME-003', 'Delivery', '2024-06-15', 'active'),
('b6b6b6b6-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
 '44444444-4444-4444-4444-444444444444', 'GLBX-001', 'Ops', '2023-11-01', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO leave_types (id, organization_id, name, default_days, is_paid) VALUES
('a7a7a7a7-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Annual', 20, true),
('b7b7b7b7-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Annual', 25, true)
ON CONFLICT (organization_id, name) DO NOTHING;

-- The sync_leave_balance trigger creates and maintains the matching
-- leave_balances rows, so the seed deliberately does not write them by hand.
INSERT INTO leave_requests (id, organization_id, employee_id, leave_type_id,
                            start_date, end_date, duration_days, status, reason) VALUES
('a8a8a8a8-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 'a6a6a6a6-0000-0000-0000-000000000002', 'a7a7a7a7-0000-0000-0000-000000000001',
 '2030-03-04', '2030-03-08', 5, 'pending', 'Seeded pending request'),
('b8b8b8b8-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
 'b6b6b6b6-0000-0000-0000-000000000001', 'b7b7b7b7-0000-0000-0000-000000000001',
 '2030-04-01', '2030-04-03', 3, 'pending', 'Other tenant request')
ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Timesheets, reports and automation
--
-- Acme has entries for both the manager and the member so the "your own, or
-- everyone's if you manage people" policies have both sides to discriminate
-- between. Globex gets one of each, for isolation.
-- -----------------------------------------------------------------------------

INSERT INTO time_entries (id, organization_id, user_id, project_id, description,
                          start_time, end_time, is_billable) VALUES
('a9a9a9a9-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '33333333-3333-3333-3333-333333333333', 'a2a2a2a2-0000-0000-0000-000000000001',
 'Member work', '2030-05-06T09:00:00Z', '2030-05-06T11:00:00Z', true),
('a9a9a9a9-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '22222222-2222-2222-2222-222222222222', 'a2a2a2a2-0000-0000-0000-000000000001',
 'Manager work', '2030-05-06T09:00:00Z', '2030-05-06T10:30:00Z', false),
('b9b9b9b9-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
 '44444444-4444-4444-4444-444444444444', 'b2b2b2b2-0000-0000-0000-000000000001',
 'Other tenant work', '2030-05-06T09:00:00Z', '2030-05-06T12:00:00Z', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO timesheet_periods (id, organization_id, user_id, period_start, period_end,
                               total_hours, billable_hours, status) VALUES
('aaaa1111-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '33333333-3333-3333-3333-333333333333', '2030-05-06', '2030-05-12', 2, 2, 'submitted'),
('bbbb1111-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
 '44444444-4444-4444-4444-444444444444', '2030-05-06', '2030-05-12', 3, 3, 'submitted')
ON CONFLICT (id) DO NOTHING;

-- One private report and one shared, so the "own or shared" policy has both.
INSERT INTO saved_reports (id, organization_id, created_by, name, entity_type,
                           columns, is_shared) VALUES
('aaaa4444-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '22222222-2222-2222-2222-222222222222', 'Manager private', 'task',
 ARRAY['task_name','status'], false),
('aaaa4444-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '22222222-2222-2222-2222-222222222222', 'Team shared', 'task',
 ARRAY['task_name','assignee'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auto_assignment_rules (id, organization_id, project_id, name, method, assignee_pool) VALUES
('aaaa5555-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 'a2a2a2a2-0000-0000-0000-000000000001', 'Round robin bugs', 'round_robin',
 ARRAY['22222222-2222-2222-2222-222222222222'::uuid, '33333333-3333-3333-3333-333333333333'::uuid])
ON CONFLICT (id) DO NOTHING;

INSERT INTO dashboard_configs (id, organization_id, user_id, name, is_default, layout) VALUES
('aaaa6666-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '22222222-2222-2222-2222-222222222222', 'My Dashboard', true, '[]'::jsonb),
('aaaa6666-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '33333333-3333-3333-3333-333333333333', 'My Dashboard', true, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Quotations so revenue_for_org has something to roll up. Two tenants, so the
-- RLS suite has a cross-tenant row to fail to read.
INSERT INTO commercial_documents (id, organization_id, workspace_id, doc_type, doc_number,
                                  status, issue_date, currency, subtotal, tax_total,
                                  discount_total, grand_total) VALUES
('aaaa7777-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 'a1a1a1a1-0000-0000-0000-000000000001', 'quotation', 'SEED-QUO-0001',
 'accepted', '2030-06-01', 'USD', 1000, 0, 0, 1000),
('bbbb7777-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
 'b1b1b1b1-0000-0000-0000-000000000001', 'quotation', 'SEED-QUO-0001',
 'accepted', '2030-06-01', 'USD', 7777, 0, 0, 7777)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Platform admin
-- -----------------------------------------------------------------------------

INSERT INTO admin_users (email, full_name, role, is_active)
VALUES ('admin@platform.test', 'Platform Admin', 'superadmin', true)
ON CONFLICT (email) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Materialized views
-- -----------------------------------------------------------------------------

-- `revenue_summary` is a materialized view, so the rows inserted above are not
-- visible through it until it is refreshed. In a running deployment the hourly
-- `refreshRevenueSummary` job does this; a freshly seeded database has never had
-- that job run, so the revenue dashboard reads as empty and the RLS suite's
-- revenue isolation test finds nothing to isolate.
--
-- Refreshing here leaves a seeded database in a state that matches what the app
-- expects, rather than one that only becomes correct an hour later.
REFRESH MATERIALIZED VIEW revenue_summary;
