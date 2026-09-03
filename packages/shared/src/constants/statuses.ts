/**
 * Canonical status and enum values. These MUST stay in sync with the CHECK
 * constraints in supabase/migrations — the database is the source of truth.
 */

// --- Organization -------------------------------------------------------------
export const ORG_STATUSES = ['active', 'trial', 'suspended', 'churned'] as const
export type OrgStatus = (typeof ORG_STATUSES)[number]

// --- Project ------------------------------------------------------------------
export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_VISIBILITY = ['workspace', 'organization'] as const
export type ProjectVisibility = (typeof PROJECT_VISIBILITY)[number]

// --- Task / subtask -----------------------------------------------------------
export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Statuses that take a task out of the active working set. */
export const CLOSED_TASK_STATUSES = ['done', 'cancelled'] as const

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Sort weight for priority — lower sorts first (most urgent first). */
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export const DEPENDENCY_TYPES = [
  'finish_to_start',
  'start_to_start',
  'finish_to_finish',
  'start_to_finish',
] as const
export type DependencyType = (typeof DEPENDENCY_TYPES)[number]

// --- Roles --------------------------------------------------------------------
export const ORG_ROLES = ['owner', 'admin', 'manager', 'member'] as const
export type OrgRole = (typeof ORG_ROLES)[number]

export const WORKSPACE_ROLES = ['admin', 'member', 'viewer'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const PROJECT_ROLES = ['owner', 'contributor', 'viewer'] as const
export type ProjectRole = (typeof PROJECT_ROLES)[number]

export const PORTAL_USER_STATUSES = ['invited', 'active', 'disabled'] as const
export type PortalUserStatus = (typeof PORTAL_USER_STATUSES)[number]

// --- Documents ----------------------------------------------------------------
export const DOCUMENT_STATUSES = ['draft', 'published', 'archived'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

// --- Commercial ---------------------------------------------------------------
export const COMMERCIAL_DOC_TYPES = [
  'purchase_order',
  'sales_order',
  'invoice',
  'bill',
  'quotation',
] as const
export type CommercialDocType = (typeof COMMERCIAL_DOC_TYPES)[number]

/** Allowed status values per document type (claude.md §6.4, §19.2). */
export const COMMERCIAL_STATUSES = {
  purchase_order: [
    'draft',
    'pending_approval',
    'approved',
    'sent',
    'partially_received',
    'received',
    'closed',
  ],
  sales_order: ['draft', 'confirmed', 'in_progress', 'fulfilled', 'closed'],
  invoice: ['draft', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'void'],
  bill: ['received', 'pending_approval', 'approved', 'partially_paid', 'paid'],
  quotation: ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'converted'],
} as const satisfies Record<CommercialDocType, readonly string[]>

export type CommercialStatus<T extends CommercialDocType = CommercialDocType> =
  (typeof COMMERCIAL_STATUSES)[T][number]

export const CONTACT_TYPES = ['client', 'vendor', 'both'] as const
export type ContactType = (typeof CONTACT_TYPES)[number]

export const LIFECYCLE_STAGES = ['lead', 'prospect', 'customer', 'churned'] as const
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]

// --- Leads --------------------------------------------------------------------
export const LEAD_SOURCES = [
  'manual',
  'web_form',
  'referral',
  'cold_call',
  'social_media',
  'advertisement',
  'event',
  'other',
] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'disqualified',
] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

// --- Workflows ----------------------------------------------------------------
export const WORKFLOW_TRIGGER_TYPES = [
  'task_event',
  'subtask_event',
  'commercial_event',
  'webhook',
  'schedule',
  'manual',
] as const
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number]

export const WORKFLOW_RUN_STATUSES = [
  'running',
  'completed',
  'failed',
  'timed_out',
  'cancelled',
] as const
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number]

/** Hard safety limits — not user-configurable (claude.md §18 rule 8). */
export const WORKFLOW_LIMITS = {
  MAX_STEPS: 50,
  MAX_RUNTIME_MS: 5 * 60 * 1000,
  MAX_RETRIES: 3,
} as const

// --- HR -----------------------------------------------------------------------
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]

export const EMPLOYEE_STATUSES = ['active', 'on_leave', 'terminated', 'probation'] as const
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]

export const LEAVE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number]

export const TIMESHEET_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number]

// --- Platform -----------------------------------------------------------------
export const AUDIT_ACTOR_TYPES = ['user', 'system', 'admin', 'workflow', 'integration'] as const
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number]

export const EVENT_SOURCES = ['app', 'workflow', 'integration', 'webhook', 'system'] as const
export type EventSource = (typeof EVENT_SOURCES)[number]

export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'dropdown',
  'checkbox',
  'url',
  'email',
  'currency',
] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export const NOTICE_TYPES = ['info', 'warning', 'critical', 'maintenance'] as const
export type NoticeType = (typeof NOTICE_TYPES)[number]

export const ANNOUNCEMENT_DISPLAY_TYPES = ['modal', 'banner', 'notification', 'changelog'] as const
export type AnnouncementDisplayType = (typeof ANNOUNCEMENT_DISPLAY_TYPES)[number]

export const DIGEST_MODES = ['instant', 'hourly', 'daily'] as const
export type DigestMode = (typeof DIGEST_MODES)[number]

export const NOTIFICATION_TYPES = [
  'task_assigned',
  'task_unassigned',
  'task_status_changed',
  'task_due_soon',
  'task_overdue',
  'comment_created',
  'comment_mention',
  'project_invite',
  'org_invite',
  'document_shared',
  'commercial_approval_requested',
  'commercial_approved',
  'leave_request_submitted',
  'leave_request_decided',
  'timesheet_submitted',
  'timesheet_decided',
  'workflow_failed',
  'system_notice',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]
