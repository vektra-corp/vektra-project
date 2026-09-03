/**
 * Canonical event types for the internal event bus (`events` table).
 *
 * Every mutation on a key table emits one of these (claude.md §18 rule 7).
 * Names are dot-notation `resource.verb` per the naming rules in §16 — the
 * `emit_event()` trigger maps table+operation to these names so that workflow
 * triggers, integrations, and activity feeds all speak one vocabulary.
 */

export const EVENT_TYPES = [
  // Tasks
  'task.created',
  'task.updated',
  'task.deleted',
  'task.status_changed',
  'task.assigned',
  'task.unassigned',
  'task.moved',
  'task.completed',
  // Subtasks
  'subtask.created',
  'subtask.updated',
  'subtask.deleted',
  'subtask.status_changed',
  'subtask.completed',
  // Projects
  'project.created',
  'project.updated',
  'project.deleted',
  'project.status_changed',
  // Collaboration
  'comment.created',
  'comment.updated',
  'comment.mention',
  'attachment.created',
  'document.created',
  'document.updated',
  'document.published',
  // Commercial
  'commercial_document.created',
  'commercial_document.updated',
  'commercial_document.status_changed',
  'commercial_document.approved',
  'commercial_document.paid',
  // CRM
  'lead.created',
  'lead.status_changed',
  'lead.converted',
  // HR
  'leave_request.submitted',
  'leave_request.decided',
  'timesheet.submitted',
  'timesheet.decided',
  // Tenancy
  'member.invited',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'workspace.created',
  // Billing
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
  'payment.succeeded',
  'payment.failed',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value)
}

/** Event types a customer may subscribe a webhook endpoint to (§6.6). */
export const WEBHOOK_SUBSCRIBABLE_EVENTS: readonly EventType[] = EVENT_TYPES.filter(
  (e) => !e.startsWith('subscription.') && !e.startsWith('payment.'),
)

/** Shape of the `payload` column for every event. */
export interface EventPayload<T = Record<string, unknown>> {
  table: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  record_id: string | null
  new: T | null
  old: T | null
  /** Field-level diff for UPDATE events: { status: { old, new } } */
  changes?: Record<string, { old: unknown; new: unknown }>
  actor_id: string | null
  timestamp: string
}
