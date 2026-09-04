# claude.md — Project Management SaaS

> This file is the single source of truth for building this project.
> Every architectural decision, schema definition, pattern, and convention lives here.
> When in doubt, follow this file. When this file is silent, ask before assuming.

---

## 1. Project overview

A multi-tenant, subscription-based project management SaaS sold across industries.

**Three deliverables:**
1. **Customer web app** (`app.yourdomain.com`) — projects, tasks, Kanban, Gantt, collaboration, workflows, commercial docs, portal
2. **Admin portal** (`admin.yourdomain.com`) — org monitoring, subscriptions, payments, notices, marketing, feature flags
3. **Backend** — Supabase (Postgres + Auth + Storage + Realtime + Edge Functions) + Next.js API routes + Inngest background jobs

**Core hierarchy:** Organization → Workspace → Project → Task → Subtask

**Monetization:** three Stripe subscription tiers (Starter, Growth, Enterprise) billed per seat per month.

---

## 2. Architecture principles

- Multi-tenant isolation enforced at the **database level** (RLS on every table), not just app code.
- All three clients (web, admin, future mobile) consume the **same API layer** — no client-specific backends.
- All external service calls (Stripe, email, AI, integrations) go through the **API layer**, never directly from the client.
- Every mutation emits an **event** to the events table — this powers workflows, activity feeds, audit logs, and integrations.
- **Denormalize `organization_id`** onto every table for fast RLS checks — never rely on joins through parent tables for tenant isolation.
- Prefer **server components** for data fetching, **client components** only when interactivity is required.
- **Fail closed** on authorization — if a permission check is ambiguous, deny access.

---

## 3. Tech stack

| Layer | Package / Service | Version | Notes |
|-------|-------------------|---------|-------|
| Framework | Next.js (App Router) | 14.x | TypeScript strict mode |
| Styling | Tailwind CSS | 3.x | |
| UI components | shadcn/ui | latest | Copy into `packages/ui`, customize there |
| State (server) | TanStack Query | 5.x | All server data goes through this |
| State (client) | Zustand | 4.x | Minimal: modals, sidebar, local UI state only |
| Forms | React Hook Form + Zod | latest | Zod schemas shared between client and server |
| Database | Supabase Postgres | Pro tier | Dedicated compute, PITR backups, Supavisor pooling |
| Auth | Supabase Auth | included | JWT with custom claims (org_id, org_role) |
| Storage | Supabase Storage | included | S3-backed, signed URLs, CDN-fronted |
| Realtime | Supabase Realtime | included | Postgres changes + broadcast channels |
| Edge Functions | Supabase Edge Functions | Deno | Stripe webhooks, PDF gen, AI orchestration |
| Background jobs | Inngest | free tier | Durable execution: imports, exports, workflows, digests |
| Cache | Upstash Redis | free tier | Rate limiting, session cache, job locks |
| Payments | Stripe Billing | API v2024 | Subscriptions, proration, dunning |
| Email | Resend | free→paid | DKIM/SPF/DMARC on your domain from day one |
| Monitoring | Sentry | free→paid | Source maps, performance, session replay |
| Uptime | Better Stack | free tier | Status page, log aggregation, alerting |
| Secrets | Doppler | free tier | Scoped per environment, rotated |
| Monorepo | Turborepo | latest | |
| CI/CD | GitHub Actions → Vercel | | Preview per PR, gated prod deploy |
| Gantt chart | Frappe Gantt | MIT | Or custom lightweight implementation |
| Rich text | Tiptap | 2.x | For task descriptions, comments, documents |
| PDF generation | @react-pdf/renderer | latest | Server-side, for commercial doc templates |
| Validation | Zod | 3.x | Shared schemas in `packages/shared` |
| Date handling | date-fns | 3.x | Never use moment.js |
| Icons | Lucide React | latest | Consistent icon set across both apps |
| DnD | @dnd-kit | latest | Kanban drag-drop |
| Testing | Vitest + Playwright | latest | Unit + E2E |

---

## 4. Monorepo structure

```
/
├── apps/
│   ├── web/                          # Customer-facing app
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── login/
│   │   │   │   │   ├── signup/
│   │   │   │   │   ├── verify/
│   │   │   │   │   ├── forgot-password/
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── (portal)/         # External user portal
│   │   │   │   │   ├── [orgSlug]/
│   │   │   │   │   │   ├── projects/
│   │   │   │   │   │   │   └── [projectId]/
│   │   │   │   │   │   └── layout.tsx
│   │   │   │   │   └── layout.tsx    # Portal-specific layout, no sidebar
│   │   │   │   ├── (dashboard)/      # Main authenticated layout
│   │   │   │   │   ├── [orgSlug]/
│   │   │   │   │   │   ├── [workspaceSlug]/
│   │   │   │   │   │   │   ├── projects/
│   │   │   │   │   │   │   │   ├── page.tsx           # Project list
│   │   │   │   │   │   │   │   ├── new/
│   │   │   │   │   │   │   │   └── [projectId]/
│   │   │   │   │   │   │   │       ├── layout.tsx     # Project nav (Board, Timeline, List, Docs)
│   │   │   │   │   │   │   │       ├── board/         # Kanban view
│   │   │   │   │   │   │   │       ├── timeline/      # Gantt view
│   │   │   │   │   │   │   │       ├── list/          # List/table view
│   │   │   │   │   │   │   │       ├── documents/
│   │   │   │   │   │   │   │       ├── tasks/
│   │   │   │   │   │   │   │       │   └── [taskId]/  # Task detail (subtask Kanban inside)
│   │   │   │   │   │   │   │       └── settings/
│   │   │   │   │   │   │   ├── commercial/
│   │   │   │   │   │   │   │   ├── purchase-orders/
│   │   │   │   │   │   │   │   ├── sales-orders/
│   │   │   │   │   │   │   │   ├── invoices/
│   │   │   │   │   │   │   │   ├── bills/
│   │   │   │   │   │   │   │   └── templates/       # PDF template editor
│   │   │   │   │   │   │   ├── workflows/
│   │   │   │   │   │   │   │   ├── page.tsx          # Workflow list
│   │   │   │   │   │   │   │   ├── new/
│   │   │   │   │   │   │   │   └── [workflowId]/
│   │   │   │   │   │   │   │       └── editor/       # Visual workflow canvas
│   │   │   │   │   │   │   └── settings/
│   │   │   │   │   │   ├── dashboard/
│   │   │   │   │   │   ├── members/
│   │   │   │   │   │   └── settings/
│   │   │   │   │   │       ├── general/
│   │   │   │   │   │       ├── billing/
│   │   │   │   │   │       ├── roles/
│   │   │   │   │   │       ├── integrations/
│   │   │   │   │   │       └── portal/
│   │   │   │   │   └── layout.tsx   # Sidebar + topbar
│   │   │   │   ├── api/
│   │   │   │   │   ├── webhooks/
│   │   │   │   │   │   ├── stripe/route.ts
│   │   │   │   │   │   └── integrations/[integrationId]/route.ts
│   │   │   │   │   ├── inngest/route.ts
│   │   │   │   │   └── cron/
│   │   │   │   │       └── overdue-tasks/route.ts
│   │   │   │   ├── layout.tsx
│   │   │   │   └── page.tsx         # Landing/marketing page or redirect
│   │   │   ├── components/           # App-specific components
│   │   │   │   ├── kanban/
│   │   │   │   ├── gantt/
│   │   │   │   ├── tasks/
│   │   │   │   ├── comments/
│   │   │   │   ├── commercial/
│   │   │   │   ├── workflows/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── portal/
│   │   │   │   └── layout/           # Sidebar, topbar, breadcrumb
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   │   ├── supabase/
│   │   │   │   │   ├── client.ts     # Browser client
│   │   │   │   │   ├── server.ts     # Server component client
│   │   │   │   │   ├── middleware.ts  # Middleware client
│   │   │   │   │   └── admin.ts      # Service role client (server only)
│   │   │   │   ├── stripe.ts
│   │   │   │   ├── inngest.ts
│   │   │   │   └── utils.ts
│   │   │   └── styles/
│   │   │       └── globals.css
│   │   ├── middleware.ts              # Auth guard, org resolution
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── admin/                         # Admin portal (separate app)
│       ├── src/
│       │   ├── app/
│       │   │   ├── (auth)/
│       │   │   │   └── login/         # Admin-only login (SSO or hardcoded)
│       │   │   ├── (dashboard)/
│       │   │   │   ├── orgs/
│       │   │   │   │   ├── page.tsx
│       │   │   │   │   └── [orgId]/
│       │   │   │   ├── users/
│       │   │   │   ├── subscriptions/
│       │   │   │   ├── payments/
│       │   │   │   ├── notices/
│       │   │   │   ├── announcements/
│       │   │   │   ├── feature-flags/
│       │   │   │   ├── marketing/
│       │   │   │   ├── support/
│       │   │   │   │   ├── audit-logs/
│       │   │   │   │   └── system-health/
│       │   │   │   └── layout.tsx
│       │   │   └── layout.tsx
│       │   ├── components/
│       │   ├── hooks/
│       │   └── lib/
│       ├── middleware.ts
│       └── package.json
│
├── packages/
│   ├── ui/                            # Shared UI component library
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── button.tsx
│   │   │   │   ├── dialog.tsx
│   │   │   │   ├── data-table.tsx
│   │   │   │   ├── form-field.tsx
│   │   │   │   ├── badge.tsx
│   │   │   │   ├── avatar.tsx
│   │   │   │   ├── dropdown-menu.tsx
│   │   │   │   ├── command.tsx
│   │   │   │   ├── toast.tsx
│   │   │   │   └── ...               # All shadcn components live here
│   │   │   ├── hooks/
│   │   │   └── utils.ts
│   │   ├── tailwind.config.ts         # Base Tailwind config extended by apps
│   │   └── package.json
│   │
│   ├── db/                            # Database types, queries, migrations
│   │   ├── src/
│   │   │   ├── types.ts               # Auto-generated: `supabase gen types typescript`
│   │   │   ├── queries/               # Typed query functions grouped by module
│   │   │   │   ├── projects.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── comments.ts
│   │   │   │   ├── commercial.ts
│   │   │   │   ├── workflows.ts
│   │   │   │   ├── users.ts
│   │   │   │   └── notifications.ts
│   │   │   └── helpers.ts
│   │   └── package.json
│   │
│   ├── auth/                          # Shared auth utilities
│   │   ├── src/
│   │   │   ├── middleware.ts           # Auth check middleware factory
│   │   │   ├── rbac.ts                # Permission checking functions
│   │   │   ├── types.ts               # Role, Permission, JWTClaims types
│   │   │   └── constants.ts           # Role definitions, permission matrix
│   │   └── package.json
│   │
│   └── shared/                        # Shared utilities, constants, validators
│       ├── src/
│       │   ├── constants/
│       │   │   ├── plans.ts           # Plan limits, feature flags per tier
│       │   │   ├── statuses.ts        # Task, project, commercial statuses
│       │   │   └── permissions.ts     # Permission matrix
│       │   ├── types/
│       │   │   ├── index.ts
│       │   │   ├── task.ts
│       │   │   ├── project.ts
│       │   │   ├── commercial.ts
│       │   │   ├── workflow.ts
│       │   │   └── notification.ts
│       │   ├── validators/            # Zod schemas (shared client + server)
│       │   │   ├── task.ts
│       │   │   ├── project.ts
│       │   │   ├── commercial.ts
│       │   │   ├── workflow.ts
│       │   │   └── auth.ts
│       │   └── utils/
│       │       ├── date.ts
│       │       ├── format.ts
│       │       ├── slug.ts
│       │       └── currency.ts
│       └── package.json
│
├── supabase/
│   ├── migrations/                    # SQL migration files (sequential)
│   │   ├── 00001_auth_and_tenancy.sql
│   │   ├── 00002_project_management.sql
│   │   ├── 00003_collaboration.sql
│   │   ├── 00004_commercial.sql
│   │   ├── 00005_workflows.sql
│   │   ├── 00006_integrations.sql
│   │   ├── 00007_platform.sql
│   │   ├── 00008_admin.sql
│   │   └── 00009_rls_policies.sql
│   ├── functions/                     # Supabase Edge Functions
│   │   ├── stripe-webhook/
│   │   │   └── index.ts
│   │   ├── pdf-generator/
│   │   │   └── index.ts
│   │   ├── workflow-engine/
│   │   │   └── index.ts
│   │   ├── ai-chat/
│   │   │   └── index.ts
│   │   └── integration-dispatch/
│   │       └── index.ts
│   ├── seed.sql                       # Dev seed data
│   └── config.toml
│
├── .github/
│   └── workflows/
│       ├── ci.yml                     # Lint, typecheck, test, RLS isolation tests
│       └── deploy.yml                 # Preview → staging → production
│
├── turbo.json
├── package.json
├── .env.example                       # Template — never commit real secrets
├── claude.md                          # THIS FILE
└── README.md
```

---

## 5. Environment setup

```bash
# Prerequisites: Node.js 20+, pnpm 8+, Docker (for local Supabase)

# Clone and install
pnpm install

# Start local Supabase
npx supabase start

# Generate types from database schema
npx supabase gen types typescript --local > packages/db/src/types.ts

# Set up environment variables (copy and fill in)
cp .env.example apps/web/.env.local
cp .env.example apps/admin/.env.local

# Start dev servers
pnpm dev          # Runs both apps via Turborepo
pnpm dev:web      # Web app only at localhost:3000
pnpm dev:admin    # Admin portal only at localhost:3001
```

**Required env vars (both apps):**
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # Server-side only, never exposed to client
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
RESEND_API_KEY=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
SENTRY_DSN=
```

---

## 6. Database schema

Every table includes `organization_id` (except `organizations` itself and admin-only tables). Every table uses `uuid` primary keys via `gen_random_uuid()`. Every table has `created_at` and `updated_at` timestamps.

### 6.1 Auth & tenancy

```sql
-- Organizations (top-level tenant)
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  logo_url      text,
  address       jsonb,         -- { street, city, state, zip, country }
  billing_email text,
  tax_id        text,
  currency      text NOT NULL DEFAULT 'USD',
  timezone      text NOT NULL DEFAULT 'UTC',
  settings      jsonb NOT NULL DEFAULT '{}',  -- MFA enforcement, session timeout, etc.
  stripe_customer_id    text UNIQUE,
  stripe_subscription_id text UNIQUE,
  plan_id       uuid REFERENCES plans(id),
  trial_ends_at timestamptz,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'trial', 'suspended', 'churned')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_stripe ON organizations(stripe_customer_id);

-- Branches (optional sub-divisions within an org)
CREATE TABLE branches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  location        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  avatar_url      text,
  phone           text,
  timezone        text DEFAULT 'UTC',
  settings        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Org members (maps users to orgs with roles)
CREATE TABLE org_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner', 'admin', 'manager', 'member')),
  branch_id       uuid REFERENCES branches(id) ON DELETE SET NULL,
  is_default      boolean NOT NULL DEFAULT false,   -- User's default org
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org ON org_members(organization_id);

-- Workspaces (logical grouping within an org)
CREATE TABLE workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  description     text,
  color           text,
  icon            text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, slug)
);

-- Workspace members (subset of org members)
CREATE TABLE workspace_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin', 'member', 'viewer')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

-- Custom roles (Enterprise tier)
CREATE TABLE roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  is_system       boolean NOT NULL DEFAULT false,  -- System roles cannot be edited
  permissions     jsonb NOT NULL DEFAULT '{}',     -- { "projects.create": true, "tasks.delete": false, ... }
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Portal users (external access)
CREATE TABLE portal_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           text NOT NULL,
  full_name       text NOT NULL,
  user_id         uuid REFERENCES auth.users(id),  -- Linked after they accept invite
  status          text NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited', 'active', 'disabled')),
  invited_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email)
);

-- Portal user project access (scoped)
CREATE TABLE portal_project_access (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id  uuid NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  can_comment     boolean NOT NULL DEFAULT true,
  can_upload      boolean NOT NULL DEFAULT false,
  granted_by      uuid REFERENCES auth.users(id),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(portal_user_id, project_id)
);
```

### 6.2 Project management

```sql
-- Projects
CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
  priority        text DEFAULT 'medium'
                  CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  start_date      date,
  end_date        date,
  budget          numeric(12, 2),
  visibility      text NOT NULL DEFAULT 'workspace'
                  CHECK (visibility IN ('workspace', 'organization')),
  settings        jsonb NOT NULL DEFAULT '{}',
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_org ON projects(organization_id);
CREATE INDEX idx_projects_workspace ON projects(workspace_id);

-- Project members
CREATE TABLE project_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'contributor'
                  CHECK (role IN ('owner', 'contributor', 'viewer')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- Kanban boards
CREATE TABLE kanban_boards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE CASCADE, -- For subtask-level boards
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'Board',
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (project_id IS NOT NULL AND task_id IS NULL) OR
    (project_id IS NULL AND task_id IS NOT NULL)
  )
);

-- Kanban columns
CREATE TABLE kanban_columns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id        uuid NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  color           text,
  position        integer NOT NULL DEFAULT 0,
  wip_limit       integer,           -- NULL = no limit
  is_done_column  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Labels
CREATE TABLE labels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE, -- NULL = org-wide
  name            text NOT NULL,
  color           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Tasks
CREATE TABLE tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kanban_column_id uuid REFERENCES kanban_columns(id) ON DELETE SET NULL,
  title           text NOT NULL,
  description     jsonb,             -- Tiptap JSON content
  status          text NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  priority        text NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  assignee_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigner_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  start_date      date,
  due_date        date,
  estimated_hours numeric(6, 2),
  actual_hours    numeric(6, 2),
  position        integer NOT NULL DEFAULT 0,  -- Order within Kanban column
  task_number     integer NOT NULL,            -- Auto-increment per project (e.g., PROJ-42)
  is_milestone    boolean NOT NULL DEFAULT false,
  started_at      timestamptz,           -- Actual work start (auto-set when status → in_progress)
  completed_at    timestamptz,           -- Actual work end (auto-set when status → done)
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_org ON tasks(organization_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE due_date IS NOT NULL;

-- Task labels (junction)
CREATE TABLE task_labels (
  task_id  uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

-- Subtasks
CREATE TABLE subtasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kanban_column_id uuid REFERENCES kanban_columns(id) ON DELETE SET NULL,
  title           text NOT NULL,
  description     jsonb,
  status          text NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  priority        text NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  assignee_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date        date,
  estimated_hours numeric(6, 2),
  position        integer NOT NULL DEFAULT 0,
  completed_at    timestamptz,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subtasks_task ON subtasks(task_id);
CREATE INDEX idx_subtasks_org ON subtasks(organization_id);

-- Task dependencies (for Gantt)
CREATE TABLE task_dependencies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  predecessor_id  uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type text NOT NULL DEFAULT 'finish_to_start'
                  CHECK (dependency_type IN ('finish_to_start', 'start_to_start',
                         'finish_to_finish', 'start_to_finish')),
  lag_days        integer NOT NULL DEFAULT 0,
  UNIQUE(predecessor_id, successor_id)
);
```

### 6.3 Collaboration

```sql
-- Comments (on tasks, subtasks, or documents)
CREATE TABLE comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id      uuid REFERENCES subtasks(id) ON DELETE CASCADE,
  document_id     uuid REFERENCES documents(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES comments(id) ON DELETE CASCADE, -- For replies
  author_id       uuid NOT NULL REFERENCES auth.users(id),
  body            jsonb NOT NULL,    -- Tiptap JSON
  is_internal     boolean NOT NULL DEFAULT false,  -- Hidden from portal users
  is_edited       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (task_id IS NOT NULL)::int +
    (subtask_id IS NOT NULL)::int +
    (document_id IS NOT NULL)::int = 1  -- Exactly one parent
  )
);

CREATE INDEX idx_comments_task ON comments(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_comments_subtask ON comments(subtask_id) WHERE subtask_id IS NOT NULL;

-- Attachments (on tasks, subtasks, comments, or documents)
CREATE TABLE attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id      uuid REFERENCES subtasks(id) ON DELETE CASCADE,
  comment_id      uuid REFERENCES comments(id) ON DELETE CASCADE,
  document_id     uuid REFERENCES documents(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  file_size       bigint NOT NULL,   -- Bytes
  mime_type       text NOT NULL,
  storage_path    text NOT NULL,     -- Path in Supabase Storage
  uploaded_by     uuid NOT NULL REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Documents (project-level)
CREATE TABLE documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           text NOT NULL,
  content         jsonb,             -- Tiptap JSON
  version         integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'archived')),
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Document versions (history)
CREATE TABLE document_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  content         jsonb NOT NULL,
  edited_by       uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, version)
);
```

### 6.4 Commercial

```sql
-- Contacts (clients and vendors)
CREATE TABLE contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('client', 'vendor', 'both')),
  company_name    text,
  contact_name    text NOT NULL,
  email           text,
  phone           text,
  address         jsonb,
  tax_id          text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Commercial documents (shared structure for PO, SO, Invoice, Bill)
CREATE TABLE commercial_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  doc_type        text NOT NULL CHECK (doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill')),
  doc_number      text NOT NULL,       -- Auto-generated, customizable format (INV-2024-0001)
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'draft',
  -- PO: draft → pending_approval → approved → sent → partially_received → received → closed
  -- SO: draft → confirmed → in_progress → fulfilled → closed
  -- Invoice: draft → sent → viewed → partially_paid → paid → overdue → void
  -- Bill: received → pending_approval → approved → partially_paid → paid
  issue_date      date NOT NULL DEFAULT CURRENT_DATE,
  due_date        date,
  currency        text NOT NULL DEFAULT 'USD',
  subtotal        numeric(12, 2) NOT NULL DEFAULT 0,
  tax_total       numeric(12, 2) NOT NULL DEFAULT 0,
  discount_total  numeric(12, 2) NOT NULL DEFAULT 0,
  grand_total     numeric(12, 2) NOT NULL DEFAULT 0,
  amount_paid     numeric(12, 2) NOT NULL DEFAULT 0,
  notes           text,
  terms           text,
  pdf_template_id uuid REFERENCES pdf_templates(id),
  reference_doc_id uuid REFERENCES commercial_documents(id), -- SO can ref PO, Invoice can ref SO
  approved_by     uuid REFERENCES auth.users(id),
  approved_at     timestamptz,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, doc_type, doc_number)
);

CREATE INDEX idx_commercial_docs_org ON commercial_documents(organization_id);
CREATE INDEX idx_commercial_docs_type ON commercial_documents(doc_type);
CREATE INDEX idx_commercial_docs_status ON commercial_documents(status);

-- Line items
CREATE TABLE commercial_line_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES commercial_documents(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity        numeric(10, 2) NOT NULL DEFAULT 1,
  unit_price      numeric(12, 2) NOT NULL,
  tax_rate        numeric(5, 2) NOT NULL DEFAULT 0,   -- Percentage
  discount        numeric(12, 2) NOT NULL DEFAULT 0,
  line_total      numeric(12, 2) NOT NULL,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- PDF templates
CREATE TABLE pdf_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type        text NOT NULL CHECK (doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill')),
  name            text NOT NULL,
  template_data   jsonb NOT NULL,     -- Template definition (field positions, styles)
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Approval chains
CREATE TABLE approval_chains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type        text NOT NULL,
  name            text NOT NULL,
  conditions      jsonb NOT NULL DEFAULT '{}',  -- e.g., { "amount_gt": 5000 }
  steps           jsonb NOT NULL,               -- [{ "role": "manager", "required": true }, ...]
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 6.5 Workflows

```sql
-- Workflows
CREATE TABLE workflows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  is_active       boolean NOT NULL DEFAULT false,
  trigger_type    text NOT NULL
                  CHECK (trigger_type IN ('task_event', 'subtask_event', 'commercial_event',
                         'webhook', 'schedule', 'manual')),
  trigger_config  jsonb NOT NULL DEFAULT '{}',   -- Event type, filters, schedule expression
  graph           jsonb NOT NULL DEFAULT '{}',   -- Full DAG: { nodes: [...], edges: [...] }
  webhook_url     text,                          -- Auto-generated unique URL for webhook triggers
  cron_expression text,                          -- For schedule triggers
  last_run_at     timestamptz,
  run_count       integer NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflows_org ON workflows(organization_id);

-- Workflow runs (execution log)
CREATE TABLE workflow_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'completed', 'failed', 'timed_out', 'cancelled')),
  trigger_data    jsonb NOT NULL,     -- Snapshot of the trigger event
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     integer,
  error           text,
  step_count      integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);

-- Workflow step logs (per-step execution detail)
CREATE TABLE workflow_step_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_id         text NOT NULL,       -- References node ID in the workflow graph JSON
  node_type       text NOT NULL,       -- 'condition', 'action', 'delay', etc.
  input           jsonb,
  output          jsonb,
  status          text NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error           text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     integer
);
```

### 6.6 Integrations

```sql
-- Connected integrations per org
CREATE TABLE integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL,       -- 'slack', 'teams', 'github', 'google', etc.
  status          text NOT NULL DEFAULT 'connected'
                  CHECK (status IN ('connected', 'disconnected', 'error')),
  access_token    text,                -- Encrypted at rest
  refresh_token   text,                -- Encrypted at rest
  token_expires_at timestamptz,
  config          jsonb NOT NULL DEFAULT '{}',  -- Provider-specific: channels, repos, etc.
  connected_by    uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, provider)
);

-- Outbound webhook endpoints (customer-configured)
CREATE TABLE webhook_endpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url             text NOT NULL,
  events          text[] NOT NULL,     -- ['task.created', 'task.status_changed', ...]
  secret          text NOT NULL,       -- For HMAC signature verification
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 6.7 Platform

```sql
-- Plans (subscription tiers)
CREATE TABLE plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,       -- 'starter', 'growth', 'enterprise'
  display_name    text NOT NULL,
  stripe_price_id_monthly text,
  stripe_price_id_annual  text,
  limits          jsonb NOT NULL DEFAULT '{}', -- See plan limits structure below
  features        jsonb NOT NULL DEFAULT '{}', -- Feature flags per plan
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Usage counters (metered per org)
CREATE TABLE usage_counters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric          text NOT NULL,       -- 'projects', 'storage_bytes', 'workflow_runs', 'portal_users', 'ai_tokens'
  current_value   bigint NOT NULL DEFAULT 0,
  limit_value     bigint,              -- NULL = unlimited
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  UNIQUE(organization_id, metric, period_start)
);

-- Notifications
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            text NOT NULL,       -- 'task_assigned', 'comment_mention', 'due_soon', etc.
  title           text NOT NULL,
  body            text,
  data            jsonb,               -- { task_id, project_id, comment_id, etc. }
  is_read         boolean NOT NULL DEFAULT false,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- Notification preferences (per user per org)
CREATE TABLE notification_preferences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  preferences     jsonb NOT NULL DEFAULT '{}',
  -- Structure: { "task_assigned": { "email": true, "push": true, "in_app": true },
  --              "comment_mention": { "email": true, "push": false, "in_app": true }, ... }
  quiet_hours     jsonb,               -- { "start": "22:00", "end": "08:00", "timezone": "America/New_York" }
  digest_mode     text DEFAULT 'instant'
                  CHECK (digest_mode IN ('instant', 'hourly', 'daily')),
  UNIQUE(user_id, organization_id)
);

-- Audit logs (immutable)
CREATE TABLE audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id        uuid REFERENCES auth.users(id),
  actor_type      text NOT NULL DEFAULT 'user'
                  CHECK (actor_type IN ('user', 'system', 'admin', 'workflow', 'integration')),
  action          text NOT NULL,       -- 'task.created', 'invoice.approved', 'user.role_changed', etc.
  resource_type   text NOT NULL,       -- 'task', 'project', 'invoice', 'user', etc.
  resource_id     uuid,
  changes         jsonb,               -- { "status": { "old": "draft", "new": "sent" } }
  metadata        jsonb,               -- IP address, user agent, etc.
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- Events (internal event bus — powers workflows, integrations, activity feeds)
CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      text NOT NULL,       -- 'task.created', 'task.status_changed', 'comment.created', etc.
  payload         jsonb NOT NULL,      -- Full event data
  source          text NOT NULL DEFAULT 'app'
                  CHECK (source IN ('app', 'workflow', 'integration', 'webhook', 'system')),
  processed       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_org_type ON events(organization_id, event_type);
CREATE INDEX idx_events_unprocessed ON events(processed) WHERE processed = false;

-- Custom fields
CREATE TABLE custom_fields (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     text NOT NULL CHECK (entity_type IN ('task', 'project', 'contact', 'commercial_document')),
  name            text NOT NULL,
  field_type      text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'checkbox', 'url', 'email', 'currency')),
  options         jsonb,               -- For dropdown: ["Option 1", "Option 2", ...]
  is_required     boolean NOT NULL DEFAULT false,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, entity_type, name)
);

-- Custom field values
CREATE TABLE custom_field_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_field_id uuid NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id       uuid NOT NULL,       -- ID of the task, project, contact, or doc
  value           jsonb NOT NULL,      -- Flexible value storage
  UNIQUE(custom_field_id, entity_id)
);

-- Import/export jobs
CREATE TABLE import_export_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('import', 'export')),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  entity_type     text NOT NULL,       -- 'tasks', 'contacts', 'projects'
  file_path       text,               -- Storage path for uploaded/generated file
  config          jsonb NOT NULL DEFAULT '{}',  -- Column mapping for imports, filters for exports
  result          jsonb,               -- { rows_processed, rows_failed, errors: [...] }
  started_by      uuid REFERENCES auth.users(id),
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 6.8 Admin portal tables

```sql
-- System notices (shown to customers)
CREATE TABLE system_notices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  body            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('info', 'warning', 'critical', 'maintenance')),
  target          jsonb NOT NULL DEFAULT '{"scope": "all"}',
  -- { "scope": "all" } | { "scope": "plans", "plans": ["growth"] } | { "scope": "orgs", "org_ids": [...] }
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      text NOT NULL,       -- Admin username
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Announcements (in-app messaging)
CREATE TABLE announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  body            text NOT NULL,
  display_type    text NOT NULL CHECK (display_type IN ('modal', 'banner', 'notification', 'changelog')),
  target          jsonb NOT NULL DEFAULT '{"scope": "all"}',
  cta_text        text,
  cta_url         text,
  is_active       boolean NOT NULL DEFAULT true,
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Feature flags
CREATE TABLE feature_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE,  -- 'gantt_chart', 'ai_chat', 'workflow_builder'
  description     text,
  is_enabled      boolean NOT NULL DEFAULT false,
  rules           jsonb NOT NULL DEFAULT '[]',
  -- [{ "type": "plan", "plans": ["growth", "enterprise"] },
  --  { "type": "org", "org_ids": ["uuid1", "uuid2"] },
  --  { "type": "percentage", "value": 25 }]
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

### 6.9 Utility functions

```sql
-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'updated_at' AND table_schema = 'public'
  LOOP
    EXECUTE format('
      CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t);
  END LOOP;
END $$;

-- Auto-increment task number per project
CREATE OR REPLACE FUNCTION set_task_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.task_number := (
    SELECT COALESCE(MAX(task_number), 0) + 1
    FROM tasks WHERE project_id = NEW.project_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_task_number_trigger
  BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_task_number();

-- Emit event on mutation (powers workflows, integrations, activity feeds)
CREATE OR REPLACE FUNCTION emit_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO events (organization_id, event_type, payload)
  VALUES (
    COALESCE(NEW.organization_id, OLD.organization_id),
    TG_TABLE_NAME || '.' || LOWER(TG_OP),  -- e.g., 'tasks.insert', 'tasks.update'
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'new', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) ELSE NULL END,
      'old', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) ELSE NULL END,
      'timestamp', now()
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Apply event emitter to key tables
CREATE TRIGGER emit_task_event AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION emit_event();
CREATE TRIGGER emit_subtask_event AFTER INSERT OR UPDATE OR DELETE ON subtasks
  FOR EACH ROW EXECUTE FUNCTION emit_event();
CREATE TRIGGER emit_comment_event AFTER INSERT OR UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION emit_event();
CREATE TRIGGER emit_commercial_event AFTER INSERT OR UPDATE ON commercial_documents
  FOR EACH ROW EXECUTE FUNCTION emit_event();

-- Custom JWT claims hook (inject org_id and role into JWT)
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  claims jsonb;
  org_id uuid;
  org_role text;
BEGIN
  claims := event->'claims';

  SELECT om.organization_id, om.role
  INTO org_id, org_role
  FROM public.org_members om
  WHERE om.user_id = (event->>'user_id')::uuid
    AND om.is_default = true
  LIMIT 1;

  IF org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{org_id}', to_jsonb(org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(org_role));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 7. Row-Level Security policies

RLS is the primary security boundary. App-level checks are defense-in-depth, never the only layer.

**Pattern:** every policy checks `organization_id` against the JWT claim `org_id`. Additional policies check workspace membership, project membership, or role-based permissions as needed.

```sql
-- Helper function: get current org_id from JWT
CREATE OR REPLACE FUNCTION auth.org_id() RETURNS uuid AS $$
  SELECT (auth.jwt()->>'org_id')::uuid;
$$ LANGUAGE sql STABLE;

-- Helper function: get current org role from JWT
CREATE OR REPLACE FUNCTION auth.org_role() RETURNS text AS $$
  SELECT auth.jwt()->>'org_role';
$$ LANGUAGE sql STABLE;

-- Helper function: check if user is member of a workspace
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper function: check if user is member of a project
CREATE OR REPLACE FUNCTION is_project_member(proj_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = proj_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ===== ORGANIZATIONS =====
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own org" ON organizations
  FOR SELECT USING (id = auth.org_id());

CREATE POLICY "Only owners can update org" ON organizations
  FOR UPDATE USING (id = auth.org_id() AND auth.org_role() = 'owner');

-- ===== WORKSPACES =====
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see workspaces in their org" ON workspaces
  FOR SELECT USING (organization_id = auth.org_id());

CREATE POLICY "Admins can create workspaces" ON workspaces
  FOR INSERT WITH CHECK (
    organization_id = auth.org_id()
    AND auth.org_role() IN ('owner', 'admin')
  );

-- ===== PROJECTS =====
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see projects in their workspaces" ON projects
  FOR SELECT USING (
    organization_id = auth.org_id()
    AND (
      visibility = 'organization'
      OR is_workspace_member(workspace_id)
    )
  );

CREATE POLICY "Workspace members can create projects" ON projects
  FOR INSERT WITH CHECK (
    organization_id = auth.org_id()
    AND is_workspace_member(workspace_id)
    AND auth.org_role() IN ('owner', 'admin', 'manager')
  );

-- ===== TASKS =====
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see tasks in accessible projects" ON tasks
  FOR SELECT USING (
    organization_id = auth.org_id()
    AND is_project_member(project_id)
  );

CREATE POLICY "Project members can create tasks" ON tasks
  FOR INSERT WITH CHECK (
    organization_id = auth.org_id()
    AND is_project_member(project_id)
  );

CREATE POLICY "Project members can update tasks" ON tasks
  FOR UPDATE USING (
    organization_id = auth.org_id()
    AND is_project_member(project_id)
  );

CREATE POLICY "Only managers+ can delete tasks" ON tasks
  FOR DELETE USING (
    organization_id = auth.org_id()
    AND auth.org_role() IN ('owner', 'admin', 'manager')
  );

-- ===== SUBTASKS (same pattern as tasks) =====
ALTER TABLE subtasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see subtasks" ON subtasks
  FOR SELECT USING (organization_id = auth.org_id());

-- ===== COMMENTS =====
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see non-internal comments" ON comments
  FOR SELECT USING (
    organization_id = auth.org_id()
    AND (is_internal = false OR auth.org_role() IS NOT NULL)
    -- Portal users (no org_role) cannot see internal comments
  );

-- ===== COMMERCIAL DOCUMENTS =====
ALTER TABLE commercial_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see commercial docs" ON commercial_documents
  FOR SELECT USING (
    organization_id = auth.org_id()
    AND auth.org_role() IN ('owner', 'admin', 'manager')
  );

-- ===== AUDIT LOGS (read-only, no delete) =====
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit logs" ON audit_logs
  FOR SELECT USING (
    organization_id = auth.org_id()
    AND auth.org_role() IN ('owner', 'admin')
  );

-- Apply RLS to ALL remaining tables following the same org_id pattern.
-- Every table with organization_id gets at minimum:
--   FOR SELECT USING (organization_id = auth.org_id())
```

---

## 8. Authentication & authorization

### Supabase Auth flow

```typescript
// apps/web/src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
```

```typescript
// apps/web/src/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)'],
}
```

### RBAC permission checking

```typescript
// packages/auth/src/rbac.ts
import type { OrgRole } from './types'

export type Module = 'projects' | 'tasks' | 'commercial' | 'users' | 'billing' | 'workflows'
export type Action = 'create' | 'read' | 'update' | 'delete' | 'approve'

const PERMISSION_MATRIX: Record<OrgRole, Record<Module, Action[]>> = {
  owner:   { projects: ['create','read','update','delete'], tasks: ['create','read','update','delete'], commercial: ['create','read','update','delete','approve'], users: ['create','read','update','delete'], billing: ['read','update'], workflows: ['create','read','update','delete'] },
  admin:   { projects: ['create','read','update','delete'], tasks: ['create','read','update','delete'], commercial: ['create','read','update','delete','approve'], users: ['create','read','update','delete'], billing: ['read'], workflows: ['create','read','update','delete'] },
  manager: { projects: ['create','read','update'], tasks: ['create','read','update','delete'], commercial: ['create','read','update'], users: ['read'], billing: [], workflows: ['create','read','update'] },
  member:  { projects: ['read'], tasks: ['create','read','update'], commercial: ['read'], users: ['read'], billing: [], workflows: ['read'] },
}

export function hasPermission(role: OrgRole, module: Module, action: Action): boolean {
  return PERMISSION_MATRIX[role]?.[module]?.includes(action) ?? false
}

export function assertPermission(role: OrgRole, module: Module, action: Action): void {
  if (!hasPermission(role, module, action)) {
    throw new Error(`Forbidden: ${role} cannot ${action} ${module}`)
  }
}
```

---

## 9. API patterns

### Server action pattern (preferred for mutations)

```typescript
// apps/web/src/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/board/actions.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { taskCreateSchema } from '@shared/validators/task'
import { assertPermission } from '@auth/rbac'

export async function createTask(projectId: string, formData: FormData) {
  const supabase = createClient()
  
  // 1. Get authenticated user + org context
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const orgRole = user.user_metadata?.org_role
  assertPermission(orgRole, 'tasks', 'create')

  // 2. Validate input
  const parsed = taskCreateSchema.safeParse({
    title: formData.get('title'),
    priority: formData.get('priority'),
    assignee_id: formData.get('assignee_id'),
    due_date: formData.get('due_date'),
  })
  if (!parsed.success) throw new Error(parsed.error.message)

  // 3. Write to database (RLS ensures org isolation)
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      ...parsed.data,
      project_id: projectId,
      organization_id: user.user_metadata.org_id,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw error

  // 4. Revalidate cache
  revalidatePath(`/projects/${projectId}/board`)
  
  return data
}
```

### API route pattern (for webhooks and external calls)

```typescript
// apps/web/src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createAdminClient()  // Service role — bypasses RLS

  switch (event.type) {
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      await supabase
        .from('organizations')
        .update({
          plan_id: /* map stripe price to plan */,
          status: subscription.status === 'active' ? 'active' : 'suspended',
        })
        .eq('stripe_subscription_id', subscription.id)
      break
    }
    case 'invoice.payment_failed': {
      // Handle dunning
      break
    }
  }

  return NextResponse.json({ received: true })
}
```

### Data fetching pattern (server components)

```typescript
// apps/web/src/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/board/page.tsx
import { createClient } from '@/lib/supabase/server'
import { KanbanBoard } from '@/components/kanban/kanban-board'

export default async function BoardPage({ params }: { params: { projectId: string } }) {
  const supabase = createClient()

  // RLS automatically filters to current org
  const { data: columns } = await supabase
    .from('kanban_columns')
    .select(`
      *,
      tasks:tasks(
        *,
        assignee:profiles!tasks_assignee_id_fkey(full_name, avatar_url),
        subtasks(count),
        labels:task_labels(label:labels(*))
      )
    `)
    .eq('board_id', /* default board for project */)
    .order('position')

  return <KanbanBoard columns={columns ?? []} projectId={params.projectId} />
}
```

---

## 10. Frontend patterns

### Component structure

```
components/
├── kanban/
│   ├── kanban-board.tsx        # Main board with DnD context
│   ├── kanban-column.tsx       # Single column with droppable zone
│   ├── kanban-card.tsx         # Task card (draggable)
│   ├── kanban-add-card.tsx     # Quick-add inline form
│   └── use-kanban.ts           # DnD logic hook
├── tasks/
│   ├── task-detail-panel.tsx   # Slide-over panel for task detail
│   ├── task-form.tsx           # Create/edit form
│   ├── task-status-badge.tsx   # Status pill component
│   ├── task-priority-icon.tsx  # Priority indicator
│   └── subtask-board.tsx       # Subtask-level Kanban inside task detail
├── gantt/
│   ├── gantt-chart.tsx         # Main Gantt component
│   ├── gantt-bar.tsx           # Individual task bar
│   ├── gantt-dependency.tsx    # Arrow between dependent tasks
│   └── gantt-header.tsx        # Date scale header
└── workflows/
    ├── workflow-canvas.tsx     # Visual node editor
    ├── workflow-node.tsx       # Individual node component
    ├── workflow-edge.tsx       # Connection line between nodes
    ├── node-config-panel.tsx   # Right panel for configuring selected node
    └── use-workflow.ts         # Workflow state management
```

### State management rules

- **Server state**: always TanStack Query. Never store fetched data in Zustand.
- **Client UI state**: Zustand. Modals, sidebar open/closed, selected items, draft form data.
- **Form state**: React Hook Form. Never manually manage form inputs.
- **URL state**: Next.js `searchParams` for filters, views, pagination. The URL should be the source of truth for anything that should survive a page refresh.

```typescript
// Example: Zustand store for UI state only
import { create } from 'zustand'

interface UIStore {
  sidebarOpen: boolean
  toggleSidebar: () => void
  activeTaskId: string | null
  setActiveTask: (id: string | null) => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  activeTaskId: null,
  setActiveTask: (id) => set({ activeTaskId: id }),
}))
```

### Real-time subscriptions

```typescript
// Subscribe to task changes in a project (client component)
'use client'
import { useEffect } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'

export function useTaskRealtime(projectId: string) {
  const queryClient = useQueryClient()
  const supabase = createBrowserClient()

  useEffect(() => {
    const channel = supabase
      .channel(`tasks:${projectId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tasks',
        filter: `project_id=eq.${projectId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [projectId])
}
```

---

## 11. Workflow builder implementation

### Workflow graph JSON structure

```typescript
interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

interface WorkflowNode {
  id: string                          // Unique within the workflow, e.g., "node_1"
  type: 'trigger' | 'condition' | 'filter' | 'delay' | 'branch' | 'action'
  action_type?: string                // For actions: 'update_fields', 'create_task', 'send_notification', etc.
  config: Record<string, unknown>     // Node-specific configuration
  position: { x: number; y: number }  // Canvas position
}

interface WorkflowEdge {
  id: string
  source: string         // Source node ID
  target: string         // Target node ID
  label?: string         // 'yes', 'no', 'branch_1', etc.
}
```

### Adjacency rules (enforced in UI and backend)

```typescript
const VALID_NEXT_NODES: Record<string, string[]> = {
  trigger:   ['condition', 'filter', 'action', 'delay'],
  condition: ['action', 'condition', 'filter', 'delay', 'branch', 'end'],
  filter:    ['action', 'condition', 'delay'],
  action:    ['action', 'condition', 'filter', 'delay', 'branch', 'end'],
  delay:     ['action', 'condition', 'filter'],
  branch:    ['action', 'condition', 'filter', 'delay'],
}
```

### Execution engine (Inngest function)

```typescript
// supabase/functions/workflow-engine/index.ts or inngest function
import { inngest } from '@/lib/inngest'

export const executeWorkflow = inngest.createFunction(
  { id: 'workflow-execute', retries: 3 },
  { event: 'workflow/trigger' },
  async ({ event, step }) => {
    const { workflow_id, trigger_data, org_id } = event.data

    // Load workflow graph
    const workflow = await step.run('load-workflow', async () => {
      // Fetch from DB
    })

    // Create run record
    const runId = await step.run('create-run', async () => {
      // Insert into workflow_runs
    })

    // Walk the DAG
    let currentNodes = [workflow.graph.nodes.find(n => n.type === 'trigger')]
    let stepCount = 0
    const MAX_STEPS = 50

    while (currentNodes.length > 0 && stepCount < MAX_STEPS) {
      for (const node of currentNodes) {
        stepCount++
        const result = await step.run(`execute-${node.id}`, async () => {
          switch (node.type) {
            case 'condition':
              return evaluateCondition(node.config, trigger_data)
            case 'action':
              return executeAction(node.action_type, node.config, trigger_data, org_id)
            case 'delay':
              // Inngest handles sleep natively
              await step.sleep(`delay-${node.id}`, node.config.duration)
              return { continued: true }
          }
        })

        // Log step result
        await step.run(`log-${node.id}`, async () => {
          // Insert into workflow_step_logs
        })

        // Find next nodes based on edges and condition results
        currentNodes = getNextNodes(workflow.graph, node.id, result)
      }
    }

    // Mark run as completed
    await step.run('complete-run', async () => {
      // Update workflow_runs
    })
  }
)
```

---

## 12. Integration engine

### Event dispatch pattern

```typescript
// Listens to the events table and dispatches to connected integrations
export const dispatchIntegrationEvents = inngest.createFunction(
  { id: 'integration-dispatch' },
  { event: 'app/event.created' },
  async ({ event, step }) => {
    const { org_id, event_type, payload } = event.data

    // Fetch active integrations for this org
    const integrations = await step.run('fetch-integrations', async () => {
      // Query integrations table where org_id matches and status = 'connected'
    })

    // Fetch active webhook endpoints for this event type
    const webhooks = await step.run('fetch-webhooks', async () => {
      // Query webhook_endpoints where events array contains event_type
    })

    // Dispatch to each integration
    for (const integration of integrations) {
      await step.run(`dispatch-${integration.provider}`, async () => {
        switch (integration.provider) {
          case 'slack':
            return sendSlackMessage(integration, event_type, payload)
          case 'teams':
            return sendTeamsMessage(integration, event_type, payload)
          case 'github':
            return syncGithubStatus(integration, event_type, payload)
        }
      })
    }

    // Dispatch to webhook endpoints
    for (const webhook of webhooks) {
      await step.run(`webhook-${webhook.id}`, async () => {
        return sendWebhook(webhook.url, webhook.secret, event_type, payload)
      })
    }
  }
)
```

---

## 13. Security — comprehensive hardening

This section is non-negotiable. Every item applies to every PR. No exceptions, no shortcuts.

### 13.1 Input validation & sanitization

```typescript
// packages/shared/src/middleware/validate.ts
import { ZodSchema } from 'zod'
import DOMPurify from 'isomorphic-dompurify'

// RULE: Every user input passes through Zod BEFORE touching the database.
export function validateInput<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new AppError(
      result.error.issues.map(i => i.message).join(', '),
      'VALIDATION_ERROR',
      400
    )
  }
  return result.data
}

// RULE: All rich text (comments, descriptions, documents) is sanitized
// SERVER-SIDE BEFORE STORAGE, not just on render.
export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
                   'h1', 'h2', 'h3', 'blockquote', 'code', 'pre', 'img', 'table',
                   'thead', 'tbody', 'tr', 'th', 'td', 'span'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel', 'data-mention-id'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['rel'],
    FORCE_BODY: true,
  })
}

// RULE: File names are stripped of path traversal and special characters
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\w\s\-\.]/g, '')     // Remove special chars
    .replace(/\.{2,}/g, '.')          // No double dots (path traversal)
    .replace(/^\./, '')               // No leading dots
    .slice(0, 255)                    // Length limit
}
```

### 13.2 XSS protection

```typescript
// apps/web/next.config.ts — Security headers
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
      "frame-src https://js.stripe.com https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '0' },   // Disabled in favor of CSP
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

// RULES:
// - NEVER use dangerouslySetInnerHTML on unsanitized input
// - NEVER interpolate user input into HTML strings
// - NEVER pass user input into href without protocol validation
// - All Tiptap/rich-text output is sanitized before storage AND on render
// - All user-generated content rendered via React (auto-escaped) except rich text
```

### 13.3 SQL injection protection

```
RULES:
- Supabase JS client uses parameterized queries by default. NEVER bypass this.
- NEVER build raw SQL from string concatenation.
- In Edge Functions, use parameterized queries: sql`SELECT * FROM tasks WHERE id = ${taskId}`
- RLS is the second layer — even if a query-layer bug exists, RLS limits the blast radius.
- In the admin portal, the read-only query tool uses a restricted database role
  with no INSERT/UPDATE/DELETE/DROP permissions.
```

### 13.4 CSRF protection

```typescript
// Next.js App Router server actions have built-in CSRF protection (origin checking).
// For API routes that accept external requests (webhooks), skip CSRF but verify signatures.
// For API routes that serve the frontend, verify the Origin header:

export function verifyCsrf(request: NextRequest): void {
  const origin = request.headers.get('origin')
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_ADMIN_URL,
  ]
  if (!origin || !allowedOrigins.includes(origin)) {
    throw new AppError('Invalid origin', 'CSRF_VIOLATION', 403)
  }
}

// RULES:
// - All state-mutating operations use POST/PUT/PATCH/DELETE, never GET
// - Stripe webhook routes verify the stripe-signature header, not CSRF
// - Integration webhook routes verify HMAC signatures per provider
```

### 13.5 Authentication

```typescript
// RULES:
// - JWTs stored in httpOnly, Secure, SameSite=Lax cookies (Lax for OAuth redirects)
// - Access tokens: 1-hour expiry. Refresh tokens: 30-day expiry with rotation.
// - On every refresh, the old refresh token is invalidated (rotation).
// - auth.getUser() is called in EVERY server action and API route — never trust
//   the client's claim of identity.
// - MFA (TOTP) is optional per user, enforceable per org on Enterprise tier.
// - OAuth providers (Google, GitHub) go through Supabase Auth PKCE flow.
// - Password requirements: minimum 8 chars, checked against haveibeenpwned API
//   (via Supabase Auth config).
// - Failed login lockout: 5 failed attempts → 15-minute lockout (via Upstash rate limit).

// Middleware pattern — runs on every request
export async function middleware(request: NextRequest) {
  // 1. Refresh session (extends expiry if still valid)
  const { data: { user }, error } = await supabase.auth.getUser()

  // 2. Redirect unauthenticated users
  if (!user && isProtectedRoute(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 3. Resolve org context from URL slug
  if (user) {
    const orgSlug = extractOrgSlug(request.nextUrl.pathname)
    if (orgSlug) {
      // Verify user is a member of this org — prevents URL tampering
      const isMember = await verifyOrgMembership(user.id, orgSlug)
      if (!isMember) return NextResponse.redirect(new URL('/403', request.url))
    }
  }

  return response
}
```

### 13.6 Session management

```
RULES:
- Active sessions are tracked in a sessions table (device, IP, last_active).
- Users can view and revoke sessions from their profile settings.
- Admins can force-revoke all sessions for a user.
- Idle timeout: configurable per org (default 30 minutes of inactivity).
- Concurrent session limit: configurable (default unlimited, Enterprise can restrict).
- On password change, ALL other sessions are revoked.
- On role change, the affected user's JWT is invalidated (force re-auth on next request).
- Session fingerprinting: store IP + user-agent hash at login, flag if it changes mid-session.
```

### 13.7 Rate limiting

```typescript
// packages/shared/src/middleware/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

// Different limiters for different endpoints
export const rateLimiters = {
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1m'),     // 5 login attempts per minute
    prefix: 'rl:auth',
  }),
  api: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(120, '1m'),    // 120 API calls per minute
    prefix: 'rl:api',
  }),
  upload: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, '1m'),     // 20 uploads per minute
    prefix: 'rl:upload',
  }),
  webhook: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1m'),    // 100 webhook calls per minute
    prefix: 'rl:webhook',
  }),
  export: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '10m'),     // 5 exports per 10 minutes
    prefix: 'rl:export',
  }),
}

export async function checkRateLimit(
  limiter: keyof typeof rateLimiters,
  identifier: string, // IP or user ID
): Promise<void> {
  const { success, remaining, reset } = await rateLimiters[limiter].limit(identifier)
  if (!success) {
    throw new AppError('Too many requests', 'RATE_LIMITED', 429)
  }
}

// RULES:
// - Rate limit by IP for unauthenticated routes (login, signup, password reset)
// - Rate limit by user ID for authenticated routes
// - Rate limit by org ID for org-scoped operations (exports, bulk actions)
// - Return Retry-After header on 429 responses
// - Log rate limit violations in audit log for abuse detection
```

### 13.8 API routing & request security

```typescript
// API route wrapper with full security chain
export function secureApiRoute(
  handler: (req: NextRequest, ctx: SecureContext) => Promise<NextResponse>,
  options: {
    requiredRole?: OrgRole[]
    requiredPermission?: { module: Module; action: Action }
    rateLimit?: keyof typeof rateLimiters
    maxBodySize?: number   // Bytes, default 1MB
  } = {}
) {
  return async (request: NextRequest) => {
    try {
      // 1. Rate limiting
      if (options.rateLimit) {
        const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
        await checkRateLimit(options.rateLimit, ip)
      }

      // 2. Body size check (prevent DoS via large payloads)
      const contentLength = parseInt(request.headers.get('content-length') ?? '0')
      const maxSize = options.maxBodySize ?? 1_048_576  // 1MB default
      if (contentLength > maxSize) {
        throw new AppError('Request body too large', 'PAYLOAD_TOO_LARGE', 413)
      }

      // 3. Auth verification
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new AppError('Unauthorized', 'UNAUTHORIZED', 401)

      // 4. Role check
      const orgRole = user.user_metadata?.org_role as OrgRole
      if (options.requiredRole && !options.requiredRole.includes(orgRole)) {
        throw new AppError('Forbidden', 'FORBIDDEN', 403)
      }

      // 5. Permission check
      if (options.requiredPermission) {
        assertPermission(orgRole, options.requiredPermission.module, options.requiredPermission.action)
      }

      // 6. Execute handler
      const ctx: SecureContext = { user, orgId: user.user_metadata.org_id, orgRole, supabase }
      return await handler(request, ctx)

    } catch (error) {
      // 7. Error handling — never leak internal details
      if (error instanceof AppError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status }
        )
      }
      // Log full error to Sentry, return generic message to client
      console.error(error)
      return NextResponse.json(
        { error: 'Internal server error', code: 'INTERNAL_ERROR' },
        { status: 500 }
      )
    }
  }
}
```

### 13.9 File upload security

```
RULES:
- Validate MIME type server-side (never trust client Content-Type header).
  Read magic bytes to verify: https://mimesniff.spec.whatwg.org/
- Reject executable file types: .exe, .sh, .bat, .cmd, .ps1, .js, .py, .rb, .php, .jsp, .asp
- Max file size enforced per plan tier (server-side check, not just client).
- File names sanitized via sanitizeFileName() before storage.
- All files served via signed URLs with 1-hour expiry (never public URLs).
- Virus scanning on upload via ClamAV (or a cloud scanner like VirusTotal API).
- Images re-encoded server-side to strip EXIF data and embedded scripts.
- Storage paths include org_id as a prefix: /{org_id}/attachments/{uuid}/{filename}
  This prevents cross-tenant file access even if a signed URL is leaked.
```

### 13.10 Encryption

```
At rest:
- Database: Supabase encrypts all data at rest (AES-256).
- Integration tokens (OAuth access/refresh tokens) encrypted using pgcrypto
  BEFORE storage. Decrypted only at the moment of use in Edge Functions.
  Key stored in Doppler, never in the database.

In transit:
- TLS 1.3 everywhere. HTTP automatically redirected to HTTPS via Cloudflare.
- Database connections use SSL (enforced by Supabase).
- Internal service calls (Edge Functions ↔ Postgres) use encrypted connections.

Secrets:
- All secrets in Doppler, scoped per environment.
- NEVER in .env files committed to git (gitignore enforced + pre-commit hook).
- API keys rotated quarterly. Stripe webhook secrets rotated on any team member departure.
- Service role key (bypasses RLS) NEVER exposed to client code. Used only in:
  1. Stripe webhook handler
  2. Admin portal backend
  3. Inngest background jobs
  4. Edge Functions that need cross-org access
```

### 13.11 Audit & monitoring

```
RULES:
- Audit log on: login, logout, role change, permission change, org settings change,
  commercial document approval, user invite/remove, data export, admin impersonation,
  subscription change, API key creation/revocation.
- Audit logs are IMMUTABLE (no UPDATE/DELETE RLS policy).
- Security events forwarded to Sentry + Better Stack for real-time alerting:
  - 5+ failed logins from same IP
  - Rate limit violations
  - RLS policy denials (logged via Supabase)
  - Admin impersonation
  - Bulk data export
  - Unusual login location (IP geolocation change)
- Weekly automated security scan of dependencies (npm audit, Snyk via GitHub Actions).
- Quarterly manual security review checklist.
```

---

## 14. Testing strategy

### Unit tests (Vitest)

- All Zod validators
- Permission matrix logic (hasPermission, assertPermission)
- Utility functions (date formatting, slug generation, currency)
- Workflow adjacency rules
- Event payload construction

### Integration tests (Vitest + Supabase local)

- RLS policies: for each table, test that Org A user cannot read/write Org B data
- RLS policies: for each role, test that permission boundaries hold
- Portal user scoping: verify portal users only see shared projects
- Workflow execution engine: test a complete workflow run end-to-end
- Stripe webhook handling: test subscription lifecycle events

### E2E tests (Playwright)

- Auth flow: signup → verify → onboarding → first project
- Task lifecycle: create project → add task → drag on Kanban → mark done
- Commercial flow: create invoice → send → mark paid
- Portal flow: invite external user → portal login → view project → comment

### CI pipeline (GitHub Actions)

```yaml
name: CI
on: [pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint          # ESLint
      - run: pnpm typecheck     # TypeScript strict
      - run: pnpm test          # Vitest (unit + integration)
      - run: pnpm test:rls      # RLS isolation tests specifically
      - run: pnpm build         # Verify build succeeds
```

---

## 15. Deployment

### Environments

| Environment | URL | Database | Stripe | Purpose |
|---|---|---|---|---|
| Local | localhost:3000/3001 | Supabase local (Docker) | Test mode | Development |
| Preview | pr-123.vercel.app | Supabase staging project | Test mode | PR review |
| Staging | staging.yourapp.com | Supabase staging project | Test mode | QA, integration testing |
| Production | app.yourapp.com | Supabase production project | Live mode | Customer-facing |

### Deploy process

1. Developer pushes to a feature branch, opens PR.
2. CI runs all checks (lint, types, tests, RLS tests, build).
3. Vercel deploys a preview URL automatically.
4. Reviewer tests on preview URL, approves PR.
5. PR merges to `develop` → auto-deploys to staging.
6. QA on staging. If good, cut a `release/*` branch, merge to `main`.
7. Merge to `main` → triggers production deploy (requires tech lead approval in GitHub Actions).
8. Post-deploy: monitor Sentry for errors, Better Stack for uptime.

### Database migrations

```bash
# Create a new migration
npx supabase migration new <name>

# Apply to local
npx supabase db reset

# Apply to staging/production
npx supabase db push --linked

# Generate updated TypeScript types after migration
npx supabase gen types typescript --linked > packages/db/src/types.ts
```

**Rule:** every migration must be backward-compatible. Never drop a column without a two-step process (1: stop reading it, 2: drop it in a later migration).

---

## 16. Coding standards

### TypeScript

- **Strict mode always.** `strict: true` in tsconfig, no `// @ts-ignore` without a comment explaining why.
- Prefer `interface` over `type` for object shapes.
- Use `as const` for literal arrays and objects.
- No `any`. Use `unknown` and narrow.
- Export types from `packages/shared/src/types/`.

### Naming

- **Files**: kebab-case (`task-detail-panel.tsx`, `use-kanban.ts`).
- **Components**: PascalCase (`TaskDetailPanel`).
- **Functions/variables**: camelCase.
- **Database columns**: snake_case.
- **API routes**: kebab-case (`/api/webhooks/stripe`).
- **Event types**: dot-notation (`task.created`, `invoice.status_changed`).
- **Feature flags**: snake_case (`gantt_chart`, `workflow_builder`).

### Commits

Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.

```
feat(kanban): add drag-drop between columns
fix(rls): patch project visibility policy for cross-workspace access
refactor(auth): extract permission check into shared package
```

### Error handling

- Server actions: throw errors, catch in the client with `useFormState` or try/catch.
- API routes: return `NextResponse.json({ error: message }, { status: code })`.
- Never expose internal error details to the client. Log them in Sentry, return a generic message.
- Use a shared `AppError` class with error codes:

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,          // 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR', etc.
    public status: number = 400,
  ) {
    super(message)
  }
}
```

### Performance

- Use `React.memo` only when profiling shows a bottleneck. Not by default.
- Images: always use `next/image` with explicit dimensions.
- Queries: always select only the columns you need, never `select('*')` in production code.
- Indexes: every foreign key column, every column used in a `WHERE` clause or `ORDER BY`, every column used in an RLS policy join.

---

## 17. Plan limits structure

```typescript
// packages/shared/src/constants/plans.ts
export const PLAN_LIMITS = {
  starter: {
    projects: 10,
    storage_bytes: 1_073_741_824,       // 1 GB
    max_file_size_bytes: 10_485_760,     // 10 MB
    portal_users: 0,
    workflows_per_workspace: 3,
    workflow_runs_per_month: 500,
    documents_per_project: 5,
    custom_fields: false,
    custom_tables: false,
    gantt: false,
    subtask_kanban: false,
    commercial: false,
    custom_roles: false,
    api_access: false,
  },
  growth: {
    projects: null,                      // Unlimited
    storage_bytes: 10_737_418_240,       // 10 GB
    max_file_size_bytes: 52_428_800,     // 50 MB
    portal_users: 5,
    workflows_per_workspace: 20,
    workflow_runs_per_month: 5_000,
    documents_per_project: null,
    custom_fields: true,
    custom_tables: false,
    gantt: true,
    subtask_kanban: true,
    commercial: true,
    custom_roles: false,
    api_access: false,
  },
  enterprise: {
    projects: null,
    storage_bytes: null,                 // Custom
    max_file_size_bytes: 104_857_600,    // 100 MB
    portal_users: null,
    workflows_per_workspace: null,
    workflow_runs_per_month: 50_000,
    documents_per_project: null,
    custom_fields: true,
    custom_tables: true,
    gantt: true,
    subtask_kanban: true,
    commercial: true,
    custom_roles: true,
    api_access: true,
  },
} as const

export type PlanName = keyof typeof PLAN_LIMITS
```

### Enforcing limits

```typescript
// packages/shared/src/utils/plan-check.ts
export async function checkPlanLimit(
  supabase: SupabaseClient,
  orgId: string,
  metric: string,
): Promise<{ allowed: boolean; current: number; limit: number | null }> {
  const { data } = await supabase
    .from('usage_counters')
    .select('current_value, limit_value')
    .eq('organization_id', orgId)
    .eq('metric', metric)
    .single()

  if (!data) return { allowed: true, current: 0, limit: null }
  if (data.limit_value === null) return { allowed: true, current: data.current_value, limit: null }
  
  return {
    allowed: data.current_value < data.limit_value,
    current: data.current_value,
    limit: data.limit_value,
  }
}
```

---

## 18. Key business rules

1. **Task numbers are sequential per project.** Task PROJ-42 means it was the 42nd task created in that project. Never reuse numbers, even after deletion.

2. **Subtasks cannot have sub-subtasks.** Two levels only (Task → Subtask). This is enforced by schema design (subtasks table has `task_id`, not `parent_id`).

3. **Kanban column order is the source of truth for task status.** When a task is dragged to a new column, its `status` field and `kanban_column_id` update simultaneously. There is no separate "change status" action that doesn't also move the card.

4. **Commercial document numbers never repeat within an org.** Format is configurable (e.g., `INV-2024-0001`). The number is assigned on creation, never changed, never recycled.

5. **Audit logs are immutable.** No UPDATE or DELETE policies on the `audit_logs` table. RLS only allows INSERT (by the system) and SELECT (by admins).

6. **Portal users see only what's explicitly shared.** The `portal_project_access` table is the allowlist. No implicit access through workspace or org membership. If the row doesn't exist, the portal user sees nothing.

7. **Events are emitted on every mutation.** The `emit_event()` trigger must fire on every INSERT, UPDATE, DELETE on key tables. Removing this trigger for performance is not allowed — it powers workflows, integrations, and audit logging.

8. **Workflow execution has hard limits.** Max 50 steps, max 5-minute runtime, max 3 retries. These are safety nets against infinite loops and runaway costs. They are not configurable by users.

9. **File attachments use signed URLs.** Never serve files from public URLs. Every file access goes through a signed URL with a 1-hour expiry. This ensures RLS-equivalent access control on file storage.

10. **Org switching generates a new JWT.** When a user switches organizations, the client calls `supabase.auth.refreshSession()` which triggers the `custom_access_token_hook` to inject the new `org_id` claim. All subsequent queries use the new org context.

---

## 19. Additional modules — schema & specs

### 19.1 Timesheet & time tracking

```sql
-- Time entries (individual time logs on tasks/subtasks)
CREATE TABLE time_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE SET NULL,
  subtask_id      uuid REFERENCES subtasks(id) ON DELETE SET NULL,
  description     text,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz,
  duration_minutes integer NOT NULL DEFAULT 0, -- Calculated or manual entry
  is_running      boolean NOT NULL DEFAULT false, -- Live timer active
  is_billable     boolean NOT NULL DEFAULT true,
  hourly_rate     numeric(10, 2),       -- Override from employee default
  total_amount    numeric(12, 2) GENERATED ALWAYS AS (
    CASE WHEN hourly_rate IS NOT NULL
      THEN ROUND((duration_minutes / 60.0) * hourly_rate, 2)
      ELSE NULL
    END
  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_time_entries_user ON time_entries(user_id, organization_id);
CREATE INDEX idx_time_entries_task ON time_entries(task_id);
CREATE INDEX idx_time_entries_project ON time_entries(project_id);
CREATE INDEX idx_time_entries_date ON time_entries(start_time);

-- Timesheet periods (weekly submission for approval)
CREATE TABLE timesheet_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  total_hours     numeric(6, 2) NOT NULL DEFAULT 0,
  billable_hours  numeric(6, 2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at    timestamptz,
  approved_by     uuid REFERENCES auth.users(id),
  approved_at     timestamptz,
  rejection_note  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id, period_start)
);
```

**Timesheet features:**
- **Timer mode**: click Start on a task → creates a time_entry with `is_running = true` and `start_time = now()`. Click Stop → sets `end_time`, calculates `duration_minutes`, sets `is_running = false`. Only one timer can be running per user at a time (enforced by a partial unique index or app logic).
- **Manual entry**: enter hours directly without a timer. Set `start_time`, `duration_minutes`, no `end_time` needed.
- **Weekly submission**: user submits a timesheet period for the week. Manager approves or rejects. Approved hours feed into revenue tracking and invoicing.
- **Billable vs non-billable**: each entry is flagged. Billable entries have an hourly rate (from employee record or project override). Billable totals roll up to project profitability and revenue tracking.
- **Task report integration**: time logged per task is visible in the task detail panel and the task report.

### 19.2 Quotation & quotation → invoice conversion

Add `'quotation'` to the commercial_documents `doc_type` enum:

```sql
ALTER TABLE commercial_documents
  DROP CONSTRAINT commercial_documents_doc_type_check,
  ADD CONSTRAINT commercial_documents_doc_type_check
    CHECK (doc_type IN ('purchase_order', 'sales_order', 'invoice', 'bill', 'quotation'));
```

**Quotation statuses:** `draft → sent → viewed → accepted → rejected → expired → converted`

**Quotation-specific fields** (stored in a JSONB `metadata` column or dedicated columns):
- `valid_until` date — expiry date for the quote
- `converted_to_id` uuid — references the invoice created from this quotation

**Conversion flow (quotation → invoice):**

```typescript
// Server action: convert quotation to invoice
export async function convertQuotationToInvoice(quotationId: string) {
  const supabase = createClient()

  // 1. Fetch the quotation with line items
  const { data: quotation } = await supabase
    .from('commercial_documents')
    .select('*, line_items:commercial_line_items(*)')
    .eq('id', quotationId)
    .eq('doc_type', 'quotation')
    .single()

  if (!quotation || quotation.status !== 'accepted') {
    throw new AppError('Only accepted quotations can be converted', 'INVALID_STATUS')
  }

  // 2. Generate next invoice number
  const invoiceNumber = await generateDocNumber(quotation.organization_id, 'invoice')

  // 3. Create invoice from quotation data
  const { data: invoice } = await supabase
    .from('commercial_documents')
    .insert({
      organization_id: quotation.organization_id,
      workspace_id: quotation.workspace_id,
      project_id: quotation.project_id,
      doc_type: 'invoice',
      doc_number: invoiceNumber,
      contact_id: quotation.contact_id,
      status: 'draft',
      issue_date: new Date().toISOString(),
      currency: quotation.currency,
      subtotal: quotation.subtotal,
      tax_total: quotation.tax_total,
      discount_total: quotation.discount_total,
      grand_total: quotation.grand_total,
      terms: quotation.terms,
      notes: quotation.notes,
      reference_doc_id: quotation.id,  // Link back to quotation
      pdf_template_id: quotation.pdf_template_id,
    })
    .select()
    .single()

  // 4. Copy line items
  const lineItems = quotation.line_items.map(item => ({
    document_id: invoice.id,
    organization_id: quotation.organization_id,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: item.tax_rate,
    discount: item.discount,
    line_total: item.line_total,
    position: item.position,
  }))
  await supabase.from('commercial_line_items').insert(lineItems)

  // 5. Update quotation status
  await supabase
    .from('commercial_documents')
    .update({ status: 'converted', metadata: { converted_to_id: invoice.id } })
    .eq('id', quotationId)

  return invoice
}
```

### 19.3 Lead management — REMOVED

Lead management was specified here and built in migration `00019`, then removed
in `00023` at the product owner's direction. `leads` and `lead_activities` no
longer exist and neither does `contacts.lead_id`.

`contacts.lifecycle_stage` is retained: it happens to include `'lead'` as a
value, but it describes where a contact sits in its own lifecycle and does not
depend on a leads table.

### 19.4 Contact expansion

Update the existing contacts table to carry lifecycle and billing data:

```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS
  lifecycle_stage     text DEFAULT 'lead'
                      CHECK (lifecycle_stage IN ('lead', 'prospect', 'customer', 'churned')),
  tags                text[],
  last_contacted_at   timestamptz,
  default_hourly_rate numeric(10, 2),   -- For timesheet billing
  total_revenue       numeric(14, 2) NOT NULL DEFAULT 0;  -- Aggregated from paid invoices
```

### 19.5 Employee management & leave tracking

```sql
-- Employees (extends org_members with HR data)
CREATE TABLE employees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  employee_code   text,                -- Company-assigned ID (e.g., EMP-001)
  department      text,
  designation     text,
  employment_type text NOT NULL DEFAULT 'full_time'
                  CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  date_of_joining date NOT NULL,
  date_of_exit    date,
  manager_id      uuid REFERENCES employees(id), -- Reporting hierarchy
  work_schedule   jsonb NOT NULL DEFAULT '{"hours_per_day": 8, "days_per_week": 5,
                  "work_days": [1,2,3,4,5]}',
  default_hourly_rate numeric(10, 2),  -- Default for timesheets
  skills          text[],              -- For auto-assignment skill matching
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'on_leave', 'terminated', 'probation')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id),
  UNIQUE(organization_id, employee_code)
);

CREATE INDEX idx_employees_org ON employees(organization_id);
CREATE INDEX idx_employees_manager ON employees(manager_id);

-- Leave types (configurable per org)
CREATE TABLE leave_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,        -- 'Annual leave', 'Sick leave', 'Personal', etc.
  color           text,
  default_days    numeric(4, 1) NOT NULL, -- Annual allocation
  is_paid         boolean NOT NULL DEFAULT true,
  requires_approval boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Leave balances (per employee per year)
CREATE TABLE leave_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year            integer NOT NULL,
  total_days      numeric(4, 1) NOT NULL,  -- Allocated
  used_days       numeric(4, 1) NOT NULL DEFAULT 0,
  pending_days    numeric(4, 1) NOT NULL DEFAULT 0,  -- Requested but not yet approved
  remaining_days  numeric(4, 1) GENERATED ALWAYS AS (total_days - used_days - pending_days) STORED,
  carried_over    numeric(4, 1) NOT NULL DEFAULT 0,
  UNIQUE(employee_id, leave_type_id, year)
);

-- Leave requests
CREATE TABLE leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   uuid NOT NULL REFERENCES leave_types(id),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  duration_days   numeric(4, 1) NOT NULL,  -- Supports half-days
  reason          text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by     uuid REFERENCES auth.users(id),
  approved_at     timestamptz,
  rejection_note  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_dates ON leave_requests(start_date, end_date);
```

**Leave features:**
- **Calendar view**: team leave calendar showing who's off when. Color-coded by leave type.
- **Approval flow**: request → manager approves/rejects → balance updated. If the org has no explicit manager, falls back to org admin.
- **Balance tracking**: auto-deduct on approval, auto-restore on cancellation. Carry-over rules configurable per leave type.
- **Auto-assignment integration**: when assigning tasks, the system checks if the target user is on leave and warns or skips them.
- **Public holidays**: org-level public holiday calendar. Leave requests that overlap with public holidays auto-exclude those days from the duration.

### 19.6 Auto-assignment

```sql
CREATE TABLE auto_assignment_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = workspace-wide
  workspace_id    uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,

  -- When to apply
  trigger_event   text NOT NULL DEFAULT 'task_created'
                  CHECK (trigger_event IN ('task_created', 'task_unassigned', 'status_changed')),
  conditions      jsonb NOT NULL DEFAULT '{}',
  -- { "labels": ["bug"], "priority": ["high", "critical"], "task_type": "any" }

  -- How to assign
  method          text NOT NULL DEFAULT 'round_robin'
                  CHECK (method IN ('round_robin', 'load_balanced', 'skill_based', 'random')),
  assignee_pool   uuid[] NOT NULL,     -- List of eligible user IDs
  config          jsonb NOT NULL DEFAULT '{}',
  -- round_robin: { "last_index": 2 }
  -- load_balanced: { "max_concurrent": 10, "respect_leave": true }
  -- skill_based: { "required_skills": ["frontend", "react"], "fallback": "round_robin" }

  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

**Auto-assignment methods:**

- **Round robin**: cycle through the assignee pool sequentially. Track the last assigned index in `config.last_index`. Skip users who are on leave (if `respect_leave` is true).
- **Load balanced**: assign to the person with the fewest open tasks (status not in `done`, `cancelled`). Optionally cap at `max_concurrent` tasks per person.
- **Skill based**: match task labels or custom fields against employee `skills[]`. If multiple matches, use round robin or load balanced as a tiebreaker. If no skill match, use the `fallback` method.
- **Random**: pick randomly from the pool. Simplest, useful for evenly distributing low-priority tasks.

**Integration with event system**: when `emit_event()` fires a `tasks.insert` event, Inngest checks for active auto-assignment rules matching the project and conditions. If a match is found and the task has no assignee, the engine assigns based on the method and emits an `tasks.update` event with the new assignee.

### 19.7 Task report (defined schema)

The task report is a table/list view with these mandatory and optional columns:

```typescript
// packages/shared/src/constants/task-report.ts

export const TASK_REPORT_COLUMNS = {
  // Core columns (always available)
  task_name:     { field: 'title',       label: 'Task name',       required: true,  sortable: true,  filterable: false },
  due_date:      { field: 'due_date',    label: 'Due date',        required: false, sortable: true,  filterable: true  },
  assigned_by:   { field: 'assigner_id', label: 'Assigned by',     required: false, sortable: true,  filterable: true, join: 'profiles' },
  assignee:      { field: 'assignee_id', label: 'Assignee',        required: false, sortable: true,  filterable: true, join: 'profiles' },
  status:        { field: 'status',      label: 'Status',          required: false, sortable: true,  filterable: true  },
  priority:      { field: 'priority',    label: 'Priority',        required: false, sortable: true,  filterable: true  },
  created_at:    { field: 'created_at',  label: 'Created',         required: false, sortable: true,  filterable: true  },
  updated_at:    { field: 'updated_at',  label: 'Last updated',    required: false, sortable: true,  filterable: true  },
  started_at:    { field: 'started_at',  label: 'Start date time', required: false, sortable: true,  filterable: true  },
  completed_at:  { field: 'completed_at',label: 'End date time',   required: false, sortable: true,  filterable: true  },

  // Extended columns
  project:       { field: 'project_id',  label: 'Project',         required: false, sortable: true,  filterable: true, join: 'projects' },
  labels:        { field: 'labels',      label: 'Labels',          required: false, sortable: false, filterable: true  },
  subtask_count: { field: '_computed',   label: 'Subtasks',        required: false, sortable: true,  filterable: false },
  time_logged:   { field: '_computed',   label: 'Time logged',     required: false, sortable: true,  filterable: false },
  estimated:     { field: 'estimated_hours', label: 'Estimated',   required: false, sortable: true,  filterable: true  },
} as const

export type TaskReportColumn = keyof typeof TASK_REPORT_COLUMNS
```

```sql
-- Saved report configurations
CREATE TABLE saved_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES auth.users(id),
  name            text NOT NULL,
  entity_type     text NOT NULL DEFAULT 'task'
                  CHECK (entity_type IN ('task', 'timesheet', 'commercial', 'employee')),
  columns         text[] NOT NULL,        -- Ordered list of column keys
  filters         jsonb NOT NULL DEFAULT '{}',
  -- { "status": ["todo", "in_progress"], "priority": ["high"], "assignee_id": ["uuid1"],
  --   "due_date": { "from": "2024-01-01", "to": "2024-12-31" } }
  sort_by         text,
  sort_order      text DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
  group_by        text,                   -- Column key to group rows by
  is_shared       boolean NOT NULL DEFAULT false,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

**Auto-set `started_at` and `completed_at`:**

```sql
-- Trigger: auto-set started_at when status changes to in_progress
CREATE OR REPLACE FUNCTION auto_set_task_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  -- Set started_at on first transition to in_progress
  IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at = now();
  END IF;

  -- Set completed_at when status changes to done
  IF NEW.status = 'done' AND OLD.status != 'done' THEN
    NEW.completed_at = now();
  END IF;

  -- Clear completed_at if task is reopened
  IF NEW.status != 'done' AND OLD.status = 'done' THEN
    NEW.completed_at = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_task_timestamps
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION auto_set_task_timestamps();

-- Same trigger for subtasks
CREATE TRIGGER auto_subtask_timestamps
  BEFORE UPDATE ON subtasks
  FOR EACH ROW EXECUTE FUNCTION auto_set_task_timestamps();
```

### 19.8 Customizable Kanban view

```sql
-- Kanban view configurations (per user or shared)
CREATE TABLE kanban_view_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_id        uuid NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES auth.users(id),
  name            text NOT NULL DEFAULT 'Default view',
  is_default      boolean NOT NULL DEFAULT false,
  is_shared       boolean NOT NULL DEFAULT false,  -- Visible to all project members

  -- Grouping: what defines the columns
  group_by        text NOT NULL DEFAULT 'status'
                  CHECK (group_by IN ('status', 'assignee', 'priority', 'label', 'custom_field', 'due_date_range')),
  group_field_id  uuid,                -- For custom_field grouping: references custom_fields(id)

  -- Column configuration
  column_config   jsonb NOT NULL DEFAULT '[]',
  -- [{ "id": "col_1", "name": "To Do", "value": "todo", "color": "#E8E8E8",
  --    "wip_limit": 5, "collapsed": false, "position": 0 }, ...]
  -- When group_by = "assignee": value = user_id
  -- When group_by = "priority": value = "high", "medium", etc.

  -- Card appearance: which fields to show on each card
  card_fields     jsonb NOT NULL DEFAULT '["assignee", "priority", "due_date", "labels", "subtask_progress"]',
  -- Options: assignee, priority, due_date, labels, subtask_progress,
  --          estimated_hours, time_logged, custom_fields, task_number

  -- Card color coding
  card_color_by   text DEFAULT 'priority'
                  CHECK (card_color_by IN ('priority', 'label', 'status', 'custom_field', 'none')),
  card_color_map  jsonb,               -- { "high": "#FF4444", "medium": "#FFAA00", ... }

  -- Swimlanes (horizontal grouping within columns)
  swimlane_by     text DEFAULT 'none'
                  CHECK (swimlane_by IN ('none', 'assignee', 'priority', 'label', 'custom_field')),

  -- Sorting within columns
  sort_by         text DEFAULT 'position'
                  CHECK (sort_by IN ('position', 'priority', 'due_date', 'created_at', 'title')),
  sort_order      text DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),

  -- Saved filters
  filters         jsonb NOT NULL DEFAULT '{}',
  -- { "assignee_id": ["uuid1", "uuid2"], "priority": ["high", "critical"],
  --   "labels": ["bug"], "due_date": { "from": "2024-01-01", "to": "2024-06-30" } }

  -- Display options
  show_empty_columns boolean NOT NULL DEFAULT true,
  show_column_count  boolean NOT NULL DEFAULT true,
  compact_mode       boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

**Kanban customization features:**

- **Group by anything**: the default is status (columns = statuses), but users can switch to group by assignee (one column per person), by priority (columns = critical/high/medium/low), by label, or by a custom field dropdown. When grouped by assignee, the column header shows the person's avatar and name, and the column is a droppable zone — dropping a card there reassigns it.
- **Card fields**: users choose which fields appear on each card via a settings panel. Minimal mode shows just title + assignee avatar. Full mode shows title, assignee, priority icon, due date, labels, subtask progress bar, and time logged.
- **Card color coding**: cards can be color-coded by priority (red = critical, orange = high, etc.), by label color, or by a custom field value. The color appears as a left border stripe on the card.
- **Swimlanes**: horizontal lanes within each column. Group by assignee within a status column, or by priority within an assignee column. Creates a 2D grid effect.
- **Saved views**: each configuration is saved as a named view. Users can switch between views from a dropdown. Shared views are visible to all project members. Personal views are private.
- **Column customization**: rename columns, reorder them, set WIP limits (warning or blocking), collapse columns, set column colors. When grouped by status, column names map to task statuses. Renaming a column renames the status.
- **Filters**: persistent filters on the view. Filter by assignee, priority, label, due date range, custom field values. Filtered-out cards are hidden, not removed.

### 19.9 Revenue tracking & dashboard

Revenue tracking is a reporting layer that aggregates data from invoices, timesheets and quotations. No separate tables — it's computed views and dashboard widgets.

```sql
-- Materialized view for revenue summary (refreshed periodically via cron)
CREATE MATERIALIZED VIEW revenue_summary AS
SELECT
  cd.organization_id,
  date_trunc('month', cd.issue_date) AS month,
  cd.currency,
  SUM(CASE WHEN cd.doc_type = 'invoice' AND cd.status = 'paid' THEN cd.grand_total ELSE 0 END) AS invoiced_revenue,
  SUM(CASE WHEN cd.doc_type = 'invoice' AND cd.status IN ('sent', 'viewed') THEN cd.grand_total ELSE 0 END) AS outstanding_invoices,
  SUM(CASE WHEN cd.doc_type = 'invoice' AND cd.status = 'overdue' THEN cd.grand_total ELSE 0 END) AS overdue_invoices,
  SUM(CASE WHEN cd.doc_type = 'quotation' AND cd.status IN ('sent', 'viewed') THEN cd.grand_total ELSE 0 END) AS pipeline_quotations,
  SUM(CASE WHEN cd.doc_type = 'quotation' AND cd.status = 'accepted' THEN cd.grand_total ELSE 0 END) AS accepted_quotations
FROM commercial_documents cd
GROUP BY cd.organization_id, date_trunc('month', cd.issue_date), cd.currency;

CREATE UNIQUE INDEX idx_revenue_summary ON revenue_summary(organization_id, month, currency);

-- Refresh via cron (Inngest scheduled function, every hour)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY revenue_summary;
```

**Revenue dashboard widgets:**
- **Revenue this month / quarter / year**: total from paid invoices
- **Outstanding**: total from sent but unpaid invoices
- **Overdue**: total from overdue invoices, with age breakdown (30/60/90 days)
- **Pipeline**: total estimated value from active quotations
- **Revenue trend**: line chart, monthly revenue over time
- **Revenue by client**: bar chart, top 10 clients by paid invoice total
- **Billable utilization**: percentage of total logged hours that are billable (from timesheets)
- **Average deal size**: mean of accepted quotation values
- **Conversion rate**: quotations sent vs accepted (percentage)

### 19.10 Fully customizable dashboard

```sql
-- Dashboard configurations (per user per org)
CREATE TABLE dashboard_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  name            text NOT NULL DEFAULT 'My Dashboard',
  is_default      boolean NOT NULL DEFAULT false,
  layout          jsonb NOT NULL DEFAULT '[]',
  -- [{ "widget_id": "w1", "type": "tasks_due_today", "x": 0, "y": 0, "w": 6, "h": 4,
  --    "config": { "project_id": null, "date_range": "this_week" } }, ...]
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id, name)
);
```

**Widget catalog:**

| Widget | Category | Config options |
|--------|----------|----------------|
| Tasks due today/this week | PM | project filter, assignee filter |
| My open tasks | PM | group by project/priority/status |
| Task completion trend | PM | date range, project filter |
| Overdue tasks | PM | project filter, assignee filter |
| Team workload | PM | workspace/project filter |
| Project progress | PM | specific project or all |
| Recent activity feed | PM | entity type filter |
| Kanban mini-view | PM | specific board |
| Invoiced revenue | Revenue | date range, currency |
| Outstanding invoices | Revenue | age breakdown |
| Revenue trend (chart) | Revenue | monthly/quarterly, date range |
| Pipeline value | Revenue | quotation |
| Revenue by client | Revenue | top N, date range |
| Billable utilization | Timesheet | date range, user filter |
| Hours logged this week | Timesheet | user or team |
| Timesheet approval pending | Timesheet | manager view |
| Leave calendar | HR | team/department filter |
| Upcoming leaves | HR | next N days |
| Active workflows | Workflow | workspace filter |
| System notices | Admin | (admin dashboard only) |
| MRR / ARR | Admin | (admin dashboard only) |
| Failed payments | Admin | (admin dashboard only) |

**Dashboard features:**
- **Grid layout**: widgets placed on a responsive grid (12 columns). Drag to move, resize handles on corners. Uses `react-grid-layout` library.
- **Multiple dashboards**: users can create multiple named dashboards and switch between them.
- **Admin can set org defaults**: admin configures a default dashboard layout that new users get on first login. Users can then customize their own.
- **Widget config panel**: click the gear icon on a widget to configure filters, date ranges, and display options.
- **Auto-refresh**: widgets poll for updates every 60 seconds or use Supabase Realtime for live updates.

---

## 20. Phased build order

Build in this order. Each phase depends on the previous one.

| Phase | Weeks | What to build |
|-------|-------|---------------|
| 0. Foundations | 2–3 | Auth, org/workspace/profile tables, RLS skeleton, CI/CD pipeline, staging env, Stripe billing skeleton, event system, type generation |
| 1. MVP | 6–8 | Projects, tasks (with started_at/completed_at auto-set), subtasks, project-level Kanban (customizable views), comments, attachments, basic notifications, task report (defined columns), basic dashboard, subscription checkout, admin console basics |
| 2. V1 | 4–6 | Subtask Kanban, Gantt chart, documents, import/export, external portal, customizable dashboard (grid layout + widget catalog), email integration, contacts, employee management, leave tracking |
| 3. V2 | 6–8 | Quotation/PO/SO/Invoice/Bill, PDF templates, quotation→invoice conversion, timesheet & time tracking, revenue tracking widgets, auto-assignment engine, workflow builder, custom fields, audit logs, Slack integration |
| 4. Hardening | 3–4 | Security review, pen test, load testing (k6 against RLS-heavy queries), backup/DR test, saved reports, status page, docs, go-live |

---

## 21. Internationalization & localization (i18n / l10n)

This app is sold globally. Every user-facing string, date, number, and currency must be localizable.

### 21.1 Stack

```
next-intl          — message translations, pluralization, ICU format
date-fns           — date formatting with locale support
Intl.NumberFormat   — native browser API for numbers and currency
Intl.DateTimeFormat — native browser API for date/time (used as fallback)
Intl.RelativeTimeFormat — "2 hours ago", "in 3 days"
```

### 21.2 Translation file structure

```
apps/web/src/messages/
├── en.json          # English (default, source of truth)
├── es.json          # Spanish
├── fr.json          # French
├── de.json          # German
├── pt.json          # Portuguese
├── ar.json          # Arabic (RTL)
├── ja.json          # Japanese
├── zh.json          # Chinese (Simplified)
└── hi.json          # Hindi
```

```json
// en.json (flat namespace structure)
{
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "confirm": "Are you sure?",
    "loading": "Loading...",
    "no_results": "No results found",
    "search": "Search..."
  },
  "tasks": {
    "title": "Tasks",
    "create": "Create task",
    "status": {
      "todo": "To Do",
      "in_progress": "In Progress",
      "in_review": "In Review",
      "done": "Done",
      "cancelled": "Cancelled"
    },
    "priority": {
      "critical": "Critical",
      "high": "High",
      "medium": "Medium",
      "low": "Low"
    },
    "due_in": "Due {relativeTime}",
    "overdue_by": "Overdue by {days, plural, one {# day} other {# days}}",
    "assigned_to": "Assigned to {name}",
    "subtask_count": "{count, plural, one {# subtask} other {# subtasks}}"
  },
  "commercial": {
    "invoice": { "title": "Invoice", "number": "Invoice #{number}" },
    "quotation": { "title": "Quotation", "valid_until": "Valid until {date}" }
  }
}
```

### 21.3 Next-intl setup

```typescript
// apps/web/src/i18n/request.ts
import { getRequestConfig } from 'next-intl/server'
import { getUserLocale } from '@/lib/locale'

export default getRequestConfig(async () => {
  const locale = await getUserLocale()  // From user profile, org default, or browser
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
```

```typescript
// apps/web/src/middleware.ts — locale resolution order
// 1. User profile setting (profiles.settings.locale)
// 2. Organization default (organizations.settings.locale)
// 3. Browser Accept-Language header
// 4. Fallback: 'en'

export async function resolveLocale(userId?: string, orgId?: string): Promise<string> {
  const supported = ['en', 'es', 'fr', 'de', 'pt', 'ar', 'ja', 'zh', 'hi']

  if (userId) {
    const userLocale = await getUserPreferredLocale(userId)
    if (userLocale && supported.includes(userLocale)) return userLocale
  }
  if (orgId) {
    const orgLocale = await getOrgDefaultLocale(orgId)
    if (orgLocale && supported.includes(orgLocale)) return orgLocale
  }
  return 'en'
}
```

### 21.4 Date, time, number, and currency formatting

```typescript
// packages/shared/src/utils/formatters.ts
import { format, formatDistanceToNow } from 'date-fns'
import { enUS, es, fr, de, pt, ar, ja, zhCN, hi } from 'date-fns/locale'

const DATE_FNS_LOCALES: Record<string, Locale> = {
  en: enUS, es, fr, de, pt, ar, ja, zh: zhCN, hi,
}

// RULE: Never use .toLocaleDateString() directly. Always go through these formatters
// so the format is consistent and configurable.

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'DD-MM-YYYY'
export type TimeFormat = '12h' | '24h'

export function formatDate(
  date: Date | string,
  options: { locale: string; dateFormat: DateFormat }
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const formatMap: Record<DateFormat, string> = {
    'DD/MM/YYYY': 'dd/MM/yyyy',
    'MM/DD/YYYY': 'MM/dd/yyyy',
    'YYYY-MM-DD': 'yyyy-MM-dd',
    'DD.MM.YYYY': 'dd.MM.yyyy',
    'DD-MM-YYYY': 'dd-MM-yyyy',
  }
  return format(d, formatMap[options.dateFormat], {
    locale: DATE_FNS_LOCALES[options.locale] ?? enUS,
  })
}

export function formatDateTime(
  date: Date | string,
  options: { locale: string; dateFormat: DateFormat; timeFormat: TimeFormat }
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const timePart = options.timeFormat === '24h' ? 'HH:mm' : 'hh:mm a'
  const datePart = formatDate(d, options)
  return `${datePart} ${format(d, timePart, { locale: DATE_FNS_LOCALES[options.locale] ?? enUS })}`
}

export function formatRelativeTime(date: Date | string, locale: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return formatDistanceToNow(d, {
    addSuffix: true,
    locale: DATE_FNS_LOCALES[locale] ?? enUS,
  })
}

export function formatCurrency(
  amount: number,
  currency: string,
  locale: string
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}
```

### 21.5 User & org locale settings

```sql
-- In profiles.settings JSON:
-- { "locale": "en", "date_format": "MM/DD/YYYY", "time_format": "12h", "timezone": "America/New_York" }

-- In organizations.settings JSON:
-- { "locale": "en", "date_format": "DD/MM/YYYY", "time_format": "24h", "timezone": "Europe/London",
--   "currency": "GBP", "fiscal_year_start": 4 }
```

```typescript
// React hook: resolves formatting options for the current user
export function useFormatOptions() {
  const userSettings = useUserSettings()
  const orgSettings = useOrgSettings()

  return {
    locale: userSettings.locale ?? orgSettings.locale ?? 'en',
    dateFormat: userSettings.date_format ?? orgSettings.date_format ?? 'YYYY-MM-DD',
    timeFormat: userSettings.time_format ?? orgSettings.time_format ?? '24h',
    timezone: userSettings.timezone ?? orgSettings.timezone ?? 'UTC',
    currency: orgSettings.currency ?? 'USD',
  }
}

// Usage in components:
function TaskDueDate({ dueDate }: { dueDate: string }) {
  const fmt = useFormatOptions()
  return <span>{formatDate(dueDate, fmt)}</span>
}
```

### 21.6 Timezone handling

```
RULES:
- ALL dates stored in the database are UTC (timestamptz).
- NEVER store local times. Convert to UTC on write, convert to user timezone on read.
- The user's timezone comes from their profile (profiles.settings.timezone).
- The org's timezone is the fallback.
- date-fns-tz handles all conversions:
    import { formatInTimeZone } from 'date-fns-tz'
    formatInTimeZone(utcDate, userTimezone, 'yyyy-MM-dd HH:mm')
- Cron-based workflows and scheduled reports respect the ORG timezone, not UTC.
- Due date comparisons ("overdue") use the org timezone to determine "end of day".
```

### 21.7 RTL support

```typescript
// apps/web/src/app/layout.tsx
export default function RootLayout({ children, params }: { children: React.ReactNode, params: { locale: string } }) {
  const dir = ['ar', 'he', 'fa', 'ur'].includes(params.locale) ? 'rtl' : 'ltr'

  return (
    <html lang={params.locale} dir={dir}>
      <body className={dir === 'rtl' ? 'font-arabic' : ''}>
        {children}
      </body>
    </html>
  )
}

// Tailwind CSS: use logical properties (start/end instead of left/right)
// ps-4 instead of pl-4, pe-4 instead of pr-4, ms-auto instead of ml-auto
// This ensures layouts flip correctly for RTL languages.
```

### 21.8 Translation workflow

```
- English (en.json) is the source of truth. All new keys are added here first.
- Translations are managed via a service (Crowdin, Lokalise, or Tolgee).
- CI checks for missing translation keys: every key in en.json must exist in all locale files.
- Fallback: if a key is missing in a locale, fall back to English (never show a raw key).
- Developers NEVER hardcode user-facing strings. Always use t('key').
- Error messages from the API are returned as error CODES ('VALIDATION_ERROR'),
  and the client maps them to translated strings. The API never sends localized text.
```

---

## 22. System design & architecture

### 22.1 Layered architecture

```
┌──────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                       │
│  Next.js Pages, Server Components, Client Components      │
│  Responsibility: render UI, capture user input             │
├──────────────────────────────────────────────────────────┤
│  API LAYER                                                │
│  Server Actions, API Routes, Middleware                    │
│  Responsibility: auth, validation, rate limiting, routing  │
├──────────────────────────────────────────────────────────┤
│  SERVICE LAYER                                            │
│  Business logic functions (pure, testable)                 │
│  Responsibility: orchestrate operations, enforce rules     │
├──────────────────────────────────────────────────────────┤
│  REPOSITORY LAYER                                         │
│  Supabase client queries (packages/db/src/queries/)        │
│  Responsibility: data access, query construction           │
├──────────────────────────────────────────────────────────┤
│  DATA LAYER                                               │
│  Supabase Postgres + RLS                                   │
│  Responsibility: storage, tenant isolation, constraints    │
└──────────────────────────────────────────────────────────┘

Cross-cutting concerns (applied at every layer):
  → Authentication (middleware + RLS)
  → Authorization (RBAC + RLS)
  → Input validation (Zod)
  → Error handling (AppError)
  → Logging (Sentry + structured logs)
  → i18n (next-intl)
  → Rate limiting (Upstash)
```

### 22.2 Service layer pattern

```typescript
// packages/db/src/services/task-service.ts
// Services contain business logic. They are pure functions that take a Supabase client
// and return data. They do NOT handle auth, validation, or HTTP — that's the API layer's job.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types'

export class TaskService {
  constructor(private db: SupabaseClient<Database>) {}

  async createTask(input: TaskCreateInput & { orgId: string; userId: string }) {
    // Business rule: check plan limit
    const limit = await checkPlanLimit(this.db, input.orgId, 'tasks')
    if (!limit.allowed) throw new AppError('Task limit reached for your plan', 'PLAN_LIMIT', 403)

    // Business rule: if project has auto-assignment rules and no assignee, auto-assign
    if (!input.assignee_id) {
      input.assignee_id = await this.autoAssign(input.project_id, input)
    }

    // Insert task (RLS ensures org isolation)
    const { data, error } = await this.db
      .from('tasks')
      .insert({
        ...input,
        organization_id: input.orgId,
        created_by: input.userId,
      })
      .select(`*, assignee:profiles!tasks_assignee_id_fkey(full_name, avatar_url)`)
      .single()

    if (error) throw error

    // Increment usage counter
    await incrementUsage(this.db, input.orgId, 'tasks')

    return data
  }

  async moveTask(taskId: string, newColumnId: string, newPosition: number) {
    // Business rule: check WIP limit on target column
    const column = await this.db.from('kanban_columns').select('*').eq('id', newColumnId).single()
    if (column.data?.wip_limit) {
      const { count } = await this.db.from('tasks').select('*', { count: 'exact' }).eq('kanban_column_id', newColumnId)
      if (count && count >= column.data.wip_limit) {
        throw new AppError(`Column "${column.data.name}" has reached its WIP limit`, 'WIP_LIMIT', 400)
      }
    }

    // Business rule: map column to status
    const newStatus = await this.columnToStatus(newColumnId)

    // Update task
    const { data, error } = await this.db
      .from('tasks')
      .update({ kanban_column_id: newColumnId, position: newPosition, status: newStatus })
      .eq('id', taskId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  private async autoAssign(projectId: string, taskData: TaskCreateInput): Promise<string | null> {
    // Fetch active auto-assignment rules for this project
    // Evaluate conditions against task data
    // Apply the matching method (round_robin, load_balanced, etc.)
    // Return assignee user_id or null
  }
}
```

### 22.3 Request lifecycle

```
Client request
  → Cloudflare (DDoS, bot filtering, SSL)
  → Vercel Edge (CDN, static assets)
  → Next.js Middleware
      → Rate limit check (Upstash Redis)
      → Session refresh (Supabase Auth)
      → Org context resolution (from URL slug)
      → Locale resolution (user → org → browser → 'en')
  → Page / Server Action / API Route
      → Auth verification (supabase.auth.getUser())
      → RBAC permission check (assertPermission)
      → Input validation (Zod schema)
      → Service layer (business logic)
      → Repository layer (Supabase client query, RLS-filtered)
      → Response (serialized, sanitized, no internal details)
  → Security headers applied (CSP, HSTS, X-Frame-Options)
  → Client response
```

### 22.4 Multi-tenancy isolation layers

```
Layer 1: URL namespace     — /org-slug/workspace-slug/... (routing)
Layer 2: JWT claim         — org_id injected into every JWT (identity)
Layer 3: RLS policy        — every query filtered by org_id (data)
Layer 4: Storage prefix    — /{org_id}/... file paths (files)
Layer 5: App-level check   — assertPermission() (defense in depth)
Layer 6: Audit logging     — every sensitive action logged (accountability)

If any single layer fails, the other layers still prevent cross-tenant access.
```

### 22.5 Scalability design

```
Current architecture scales to ~10,000 organizations / ~100,000 users before
needing changes. Here's the scaling path:

Phase 1 (0 → 1,000 orgs): current architecture unchanged.
  - Supabase Pro (dedicated compute)
  - Vercel Pro
  - Single Postgres instance with Supavisor connection pooling

Phase 2 (1,000 → 10,000 orgs):
  - Add Supabase read replica for reporting queries and dashboards
  - Move heavy reads (revenue_summary, audit_logs, analytics) to the replica
  - Add Cloudflare R2 for file storage (eliminate egress fees)
  - Add CDN caching for static API responses (plan limits, feature flags)

Phase 3 (10,000+ orgs):
  - Consider horizontal partitioning (shard by org_id range)
  - Move workflow execution to dedicated infrastructure (separate from API)
  - Add dedicated search (Typesense/Meilisearch) for full-text across tasks/docs
  - Consider moving from Vercel to containerized deployment (Railway, Fly.io, or ECS)
    for more control over compute and long-running processes

What NOT to do prematurely:
  - Don't shard the database before you have evidence of bottlenecks
  - Don't add Kubernetes before you have a dedicated ops engineer
  - Don't build a microservices architecture — the monorepo with clean service layers
    gives you the same separation with far less operational complexity
```

---

## 23. Performance optimization

### 23.1 Database performance

```sql
-- Index strategy: every column used in WHERE, JOIN, ORDER BY, or RLS policies
-- Already covered in schema section. Additionally:

-- Partial indexes for common query patterns
CREATE INDEX idx_tasks_open ON tasks(project_id, assignee_id)
  WHERE status NOT IN ('done', 'cancelled');

CREATE INDEX idx_tasks_overdue ON tasks(due_date)
  WHERE status NOT IN ('done', 'cancelled') AND due_date < CURRENT_DATE;

CREATE INDEX idx_invoices_unpaid ON commercial_documents(organization_id, due_date)
  WHERE doc_type = 'invoice' AND status IN ('sent', 'viewed', 'overdue');

-- Connection pooling: Supavisor (included with Supabase Pro)
-- Set pool_mode = 'transaction' for serverless (Next.js API routes)
-- This prevents connection exhaustion from concurrent serverless function invocations.

-- Query performance rules:
-- 1. ALWAYS select only needed columns: .select('id, title, status, assignee_id')
-- 2. NEVER .select('*') in production code
-- 3. Use .limit() on all list queries (default 50, max 100 per page)
-- 4. Paginate with cursor-based pagination (WHERE id > last_id ORDER BY id LIMIT 50)
--    NOT offset-based (OFFSET is slow on large tables)
-- 5. Use EXPLAIN ANALYZE on any query that takes > 100ms
-- 6. Refresh materialized views (revenue_summary) via Inngest cron, not on every request
```

### 23.2 Frontend performance

```typescript
// RULES:
// 1. Code splitting: every route is automatically code-split by Next.js App Router.
//    Heavy components (Gantt, workflow canvas, rich text editor) use dynamic imports:
const GanttChart = dynamic(() => import('@/components/gantt/gantt-chart'), {
  loading: () => <GanttSkeleton />,
  ssr: false,  // Gantt uses canvas/DOM APIs, no SSR benefit
})

// 2. Images: always next/image with explicit width/height.
//    Avatars: 40x40 with quality={75}. Attachments previews: 200x200 thumbnails.

// 3. Lists: virtualize any list > 50 items using @tanstack/react-virtual
//    Kanban columns with many cards, task lists, audit logs, notification feeds.

// 4. Skeleton screens: every async-loaded section shows a skeleton, never a blank space.

// 5. Optimistic updates on Kanban: when dragging a card, update the UI immediately,
//    then sync to the database. Revert on error.

// 6. Debounce search inputs (300ms). Debounce autosave on rich text editors (1000ms).

// 7. TanStack Query cache: staleTime = 30s for most queries, 5min for slow-changing data
//    (plan limits, org settings). gcTime = 10min.

// 8. Prefetch: on hover over a project link, prefetch the project's board data.
//    router.prefetch() for route prefetching, queryClient.prefetchQuery() for data.

// 9. Bundle analysis: run `npx @next/bundle-analyzer` monthly. Flag any package > 50KB.
//    Known heavy packages that MUST be lazy-loaded:
//    - Tiptap (rich text editor)
//    - Frappe Gantt / custom Gantt
//    - Workflow canvas (react-flow or custom)
//    - PDF renderer (@react-pdf/renderer)
//    - Chart libraries (recharts)
```

### 23.3 Caching strategy

```
Level 1: Browser cache
  - Static assets (JS, CSS, images): immutable cache headers via Vercel
  - API responses: Cache-Control on GET endpoints for slow-changing data

Level 2: CDN (Vercel Edge / Cloudflare)
  - Marketing pages: cached at edge, revalidated every hour
  - Static API responses (plan features, feature flags): cached 5 minutes
  - User-specific pages: no CDN cache (personalized)

Level 3: Redis (Upstash)
  - Rate limit counters (60-second window)
  - User permission cache (org_role, workspace memberships) — 5-minute TTL
  - Plan limit cache (current usage vs limits) — 1-minute TTL
  - Feature flag evaluation results — 5-minute TTL
  - Session data (active sessions list) — 30-minute TTL

Level 4: Database
  - Materialized views (revenue_summary) refreshed hourly via cron
  - Denormalized counters (task count per project, subtask count per task)
    updated via triggers, not computed on every read

Cache invalidation:
  - Redis caches use TTL (time-based expiry), never manual invalidation
  - TanStack Query invalidation on mutation (revalidatePath, invalidateQueries)
  - Materialized views refreshed by Inngest cron function
```