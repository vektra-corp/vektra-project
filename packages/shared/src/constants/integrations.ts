import { EVENT_TYPES, type EventType } from './events'

/**
 * Integrations (§6.6, §12).
 *
 * Everything here is pure: which providers exist, which events an integration
 * may subscribe to, and how an event row becomes a human sentence. The
 * transport lives in the app; this decides *what* to say, so it can be tested
 * without a network or a Slack workspace.
 */

export const INTEGRATION_PROVIDERS = ['slack'] as const
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]

export const INTEGRATION_LABELS: Record<IntegrationProvider, string> = {
  slack: 'Slack',
}

/**
 * The Slack scopes we ask for, and no more.
 *
 * `chat:write` posts; `channels:read` lists public channels so the settings UI
 * can offer a picker instead of asking for a channel ID. Notably absent are any
 * `read` scopes for message history — we never need to read what people say,
 * and asking for it would be both a privacy problem and a harder install
 * review.
 */
export const SLACK_SCOPES = ['chat:write', 'chat:write.public', 'channels:read'] as const

/**
 * Events an integration can be subscribed to.
 *
 * Billing events are excluded for the same reason webhooks exclude them: they
 * concern the account rather than the work, and routing them to a team channel
 * leaks commercial detail to everyone in it.
 */
export const INTEGRATION_SUBSCRIBABLE_EVENTS: readonly EventType[] = EVENT_TYPES.filter(
  (event) => !event.startsWith('subscription.') && !event.startsWith('payment.'),
)

/** The default subscription for a newly connected integration. */
export const DEFAULT_INTEGRATION_EVENTS: readonly EventType[] = [
  'task.created',
  'task.completed',
  'comment.created',
  'commercial_document.approved',
  'commercial_document.paid',
]

export interface SlackConfig {
  teamId: string | null
  teamName: string | null
  channelId: string | null
  channelName: string | null
  events: string[]
}

export function parseSlackConfig(value: unknown): SlackConfig {
  const raw = (value ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : null)

  const events = Array.isArray(raw.events)
    ? raw.events.filter(
        (event): event is string =>
          typeof event === 'string'
          && (INTEGRATION_SUBSCRIBABLE_EVENTS as readonly string[]).includes(event),
      )
    : [...DEFAULT_INTEGRATION_EVENTS]

  return {
    teamId: text('teamId'),
    teamName: text('teamName'),
    channelId: text('channelId'),
    channelName: text('channelName'),
    events,
  }
}

// --- message formatting -------------------------------------------------------

export interface EventForMessage {
  eventType: string
  payload: Record<string, unknown>
  actorName?: string | null
}

const VERB: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  deleted: 'deleted',
  completed: 'completed',
  approved: 'approved',
  paid: 'paid',
  status_changed: 'changed the status of',
  assigned: 'assigned',
  submitted: 'submitted',
  decided: 'decided on',
  published: 'published',
  joined: 'joined',
  invited: 'invited',
  removed: 'removed',
}

const NOUN: Record<string, string> = {
  task: 'task',
  subtask: 'subtask',
  project: 'project',
  comment: 'comment',
  attachment: 'attachment',
  document: 'document',
  commercial_document: 'document',
  leave_request: 'leave request',
  timesheet: 'timesheet',
  member: 'member',
  workspace: 'workspace',
}

/**
 * A short human title for the thing an event happened to.
 *
 * Rows vary: a task has `title`, a document `doc_number`, a member nothing
 * useful. Returning null rather than inventing a label keeps the sentence
 * honest — "created a task" is better than "created Untitled".
 */
export function subjectLabel(payload: Record<string, unknown>): string | null {
  const row = (payload.new ?? payload.old) as Record<string, unknown> | null | undefined
  if (!row || typeof row !== 'object') return null

  for (const key of ['title', 'name', 'doc_number', 'full_name']) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120)
  }
  return null
}

/**
 * Render an event as one plain sentence.
 *
 * Deliberately plain text, not Slack Block Kit: the same string is useful for
 * any provider added later, and a block layout is a lot of surface for a line
 * of text. Slack's own escaping rules are applied by the caller that sends it.
 */
export function describeEvent(event: EventForMessage): string {
  const [resource = '', ...rest] = event.eventType.split('.')
  const action = rest.join('.')

  const noun = NOUN[resource] ?? resource.replace(/_/g, ' ')
  const verb = VERB[action] ?? action.replace(/_/g, ' ')
  const who = event.actorName?.trim() || 'Someone'
  const subject = subjectLabel(event.payload)

  const base = subject ? `${who} ${verb} ${noun} "${subject}"` : `${who} ${verb} a ${noun}`

  // A status change is the one case where the old and new values carry more
  // information than the verb does.
  if (action === 'updated' || action === 'status_changed') {
    const changes = event.payload.changes as
      | Record<string, { old?: unknown; new?: unknown }>
      | undefined
    const status = changes?.status
    if (status && (status.old !== undefined || status.new !== undefined)) {
      return `${base}: ${String(status.old ?? '—')} → ${String(status.new ?? '—')}`
    }
  }

  return base
}
