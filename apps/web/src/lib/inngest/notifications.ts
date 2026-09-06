import type { Database } from '@pm/db/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Notification delivery policy.
 *
 * Kept separate from the Inngest function so the decision "should this person be
 * emailed about this, right now?" is a pure function that can be reasoned about
 * and tested without a job runner. Deliberately not marked `server-only`: it
 * holds no secrets and reads no environment, and the marker would make it
 * untestable outside a server bundle.
 */

export interface DeliveryPreference {
  email: boolean
  push: boolean
  in_app: boolean
}

export interface QuietHours {
  start: string
  end: string
  timezone: string
}

export type DigestMode = 'instant' | 'hourly' | 'daily'

/** Absent preferences mean email on — a new member should not miss mentions. */
const DEFAULT_PREFERENCE: DeliveryPreference = { email: true, push: false, in_app: true }

export function preferenceFor(
  preferences: unknown,
  notificationType: string,
): DeliveryPreference {
  if (!preferences || typeof preferences !== 'object') return DEFAULT_PREFERENCE
  const entry = (preferences as Record<string, unknown>)[notificationType]
  if (!entry || typeof entry !== 'object') return DEFAULT_PREFERENCE

  const typed = entry as Partial<DeliveryPreference>
  return {
    email: typed.email ?? DEFAULT_PREFERENCE.email,
    push: typed.push ?? DEFAULT_PREFERENCE.push,
    in_app: typed.in_app ?? DEFAULT_PREFERENCE.in_app,
  }
}

/**
 * Whether `at` falls inside the user's quiet hours.
 *
 * Windows that cross midnight (22:00–08:00) are the normal case, so the
 * comparison is written to handle the wrap rather than assuming start < end.
 * Evaluated in the user's own timezone, never the server's (§21.6).
 */
export function inQuietHours(quietHours: unknown, at: Date): boolean {
  if (!quietHours || typeof quietHours !== 'object') return false
  const window = quietHours as Partial<QuietHours>
  if (!window.start || !window.end) return false

  const timezone = window.timezone || 'UTC'
  let local: string
  try {
    local = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at)
  } catch {
    // An unknown timezone must not silence notifications forever.
    return false
  }

  const minutes = (value: string) => {
    const [h, m] = value.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }

  const now = minutes(local)
  const start = minutes(window.start)
  const end = minutes(window.end)

  return start <= end ? now >= start && now < end : now >= start || now < end
}

export function digestModeOf(value: unknown): DigestMode {
  return value === 'hourly' || value === 'daily' ? value : 'instant'
}

/**
 * Build the in-app URL a notification points at.
 *
 * Returns null rather than a guess when the payload lacks the ids: a link to the
 * wrong task is worse than no link.
 */
export function notificationUrl(
  appUrl: string,
  orgSlug: string,
  data: unknown,
): string | null {
  if (!data || typeof data !== 'object') return null
  const payload = data as Record<string, unknown>

  // The public ids, not the uuids: a URL addresses a row by its public id
  // (migration 00034). They arrive as JSON numbers, and are safe integers by
  // construction, so String() reproduces the digits exactly.
  const id = (key: string): string | null => {
    const value = payload[key]
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
    return typeof value === 'string' && /^\d{16}$/.test(value) ? value : null
  }

  const workspaceSlug = typeof payload.workspace_slug === 'string' ? payload.workspace_slug : null
  const projectId = id('project_public_id')
  const taskId = id('task_public_id')

  if (workspaceSlug && projectId && taskId) {
    return `${appUrl}/${orgSlug}/${workspaceSlug}/projects/${projectId}/tasks/${taskId}`
  }

  // Notifications written before 00036 carry uuids and no slug, so there is no
  // link that can be built from them. The inbox is the honest fallback.
  return `${appUrl}/${orgSlug}/notifications`
}

export type Db = SupabaseClient<Database>
