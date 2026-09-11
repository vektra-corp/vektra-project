import 'server-only'

import type { Database } from '@pm/db/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/client'
import { notificationEmail } from '@/lib/email/templates'
import { digestModeOf, inQuietHours, preferenceFor } from '@/lib/inngest/notifications'
import { createAdminClient } from '@/lib/supabase/admin'

type Db = SupabaseClient<Database>

export interface NotifyInput {
  orgId: string
  orgSlug: string
  userId: string
  type: string
  title: string
  body: string | null
  /** Absolute, under this deployment's own origin. */
  url: string | null
  projectId: string | null
  data?: Record<string, unknown>
  /**
   * Collapse key. When given, an unread notification of the same type with the
   * same key is left alone instead of a second one being written — this is what
   * keeps "due tomorrow" from arriving every hour.
   */
  dedupeKey?: string
  /** How far back the dedupe looks. Defaults to a day. */
  dedupeWindowHours?: number
}

/**
 * Write one notification and, if the recipient wants it, email it.
 *
 * The service role throughout: everything here belongs to the RECIPIENT, and
 * RLS rightly hides it from the actor — `notifications` has no INSERT policy at
 * all, and both preference tables are readable only by their owner. Writing
 * into someone's inbox is a system action, so it is done as the system (§13.10).
 *
 * Never throws. A notification is a side effect of work that has already been
 * committed; surfacing an SMTP failure as an error on the mutation would tell
 * the user their edit failed when it did not.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const admin = createAdminClient()

    if (input.dedupeKey && (await alreadyNotified(admin, input))) return

    const { email: wantsEmail, inApp, deferred } = await resolveDelivery(admin, input)
    if (!wantsEmail && !inApp) return

    let emailedAt: string | null = null

    if (wantsEmail && !deferred) {
      const address = await addressFor(admin, input.userId)
      if (address) {
        const result = await sendEmail({
          to: address,
          ...notificationEmail({
            title: input.title,
            body: input.body,
            actionUrl: input.url,
            orgName: await orgName(admin, input.orgId),
            preferencesUrl: preferencesUrl(input),
          }),
        })
        // Stamp on a refusal that will not change either — no key, unroutable
        // address — so the delivery cron does not retry it for a day.
        if (result.ok || result.skipped) emailedAt = new Date().toISOString()
      }
    } else if (!wantsEmail) {
      // Opted out: mark handled so the cron does not reconsider it every run.
      emailedAt = new Date().toISOString()
    }

    if (!inApp && emailedAt) return

    await admin.from('notifications').insert({
      organization_id: input.orgId,
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: {
        ...(input.data ?? {}),
        project_id: input.projectId,
        url: input.url,
        ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
      },
      emailed_at: emailedAt,
    })
  } catch {
    // Deliberately swallowed — see the contract above.
  }
}

/** Notify several people about the same thing, skipping the actor. */
export async function notifyEach(
  userIds: (string | null | undefined)[],
  build: (userId: string) => NotifyInput,
  options: { exclude?: (string | null | undefined)[] } = {},
): Promise<void> {
  const excluded = new Set(options.exclude?.filter(Boolean) as string[])
  const unique = [...new Set(userIds.filter(Boolean) as string[])].filter(
    (id) => !excluded.has(id),
  )
  // Sequential on purpose: these share a service-role client and a provider
  // rate limit, and the recipient lists here are small (an assignee and an
  // assigner, not a broadcast).
  for (const userId of unique) await notify(build(userId))
}

/**
 * Whether an equivalent notification is already sitting there.
 *
 * Keyed on the payload rather than a column so no migration is needed to add a
 * new collapsing rule. Scoped to unread rows: once someone has read "due
 * tomorrow", a later reminder is new information rather than a duplicate.
 */
async function alreadyNotified(admin: Db, input: NotifyInput): Promise<boolean> {
  const since = new Date(
    Date.now() - (input.dedupeWindowHours ?? 24) * 3600_000,
  ).toISOString()

  const { data } = await admin
    .from('notifications')
    .select('id')
    .eq('user_id', input.userId)
    .eq('organization_id', input.orgId)
    .eq('type', input.type)
    .eq('data->>dedupe_key', input.dedupeKey!)
    .gte('created_at', since)
    .limit(1)

  return Boolean(data?.length)
}

/**
 * Resolve delivery against the project override, then the org row, then the
 * built-in default.
 *
 * A project row that is muted stops everything for that project and only that
 * project — which is the whole point of it being per project and per user.
 */
async function resolveDelivery(
  admin: Db,
  input: NotifyInput,
): Promise<{ email: boolean; inApp: boolean; deferred: boolean }> {
  const [{ data: orgPrefs }, { data: projectPrefs }] = await Promise.all([
    admin
      .from('notification_preferences')
      .select('preferences, quiet_hours, digest_mode')
      .eq('user_id', input.userId)
      .eq('organization_id', input.orgId)
      .maybeSingle(),
    input.projectId
      ? admin
          .from('project_notification_preferences')
          .select('preferences, muted')
          .eq('user_id', input.userId)
          .eq('project_id', input.projectId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (projectPrefs?.muted) return { email: false, inApp: false, deferred: false }

  const base = preferenceFor(orgPrefs?.preferences, input.type)

  // The project row is partial by design: a type it says nothing about falls
  // through to the org answer rather than resetting to the default.
  const override = projectPrefs?.preferences
    ? (projectPrefs.preferences as Record<string, unknown>)[input.type]
    : undefined

  const resolved =
    override && typeof override === 'object'
      ? { ...base, ...(override as Partial<typeof base>) }
      : base

  return {
    email: resolved.email,
    inApp: resolved.in_app,
    // Quiet hours and digests mean "not by email right now" — the row is left
    // unstamped so the job that honours them picks it up.
    deferred:
      inQuietHours(orgPrefs?.quiet_hours, new Date()) ||
      digestModeOf(orgPrefs?.digest_mode) !== 'instant',
  }
}

async function addressFor(admin: Db, userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId)
  return data.user?.email ?? null
}

async function orgName(admin: Db, orgId: string): Promise<string> {
  const { data } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle()
  return data?.name ?? 'your team'
}

function preferencesUrl(input: NotifyInput): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return null
  return `${appUrl}/${input.orgSlug}/settings/profile`
}
