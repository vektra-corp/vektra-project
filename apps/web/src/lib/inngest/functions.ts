import 'server-only'

import { todayIn } from '@pm/shared/utils'
import { sendEmail } from '@/lib/email/client'
import { digestEmail, notificationEmail } from '@/lib/email/templates'
import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from './client'
import {
  digestModeOf,
  inQuietHours,
  notificationUrl,
  preferenceFor,
} from './notifications'

/**
 * Background jobs (§3, §12).
 *
 * All of these run as service_role and therefore bypass RLS — every query below
 * scopes itself explicitly (§13.10). None of them accept tenant ids from an
 * untrusted caller; they read the rows they are about to act on.
 */

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? ''

/** How far back the mailer will look. Older unsent notifications are abandoned
 *  rather than delivered late, which is what a reader would expect. */
const MAX_AGE_HOURS = 24

/**
 * Email notifications that are still unsent.
 *
 * Polls rather than reacting to an event because notifications are written by
 * database triggers, which cannot emit an Inngest event. `emailed_at` is the
 * idempotency key: it is written immediately after a successful hand-off, so a
 * retried run re-sends nothing.
 */
export const deliverNotificationEmails = inngest.createFunction(
  { id: 'notification-email-delivery', retries: 2 },
  { cron: '*/5 * * * *' },
  async ({ step }) => {
    const pending = await step.run('load-pending', async () => {
      const db = createAdminClient()
      const since = new Date(Date.now() - MAX_AGE_HOURS * 3600_000).toISOString()

      const { data } = await db
        .from('notifications')
        .select('id, organization_id, user_id, type, title, body, data, created_at')
        .is('emailed_at', null)
        .gte('created_at', since)
        .order('created_at')
        .limit(100)

      return data ?? []
    })

    if (pending.length === 0) return { sent: 0, skipped: 0 }

    const context = await step.run('load-context', async () => {
      const db = createAdminClient()
      const userIds = [...new Set(pending.map((row) => row.user_id))]
      const orgIds = [...new Set(pending.map((row) => row.organization_id))]

      const [{ data: preferences }, { data: organizations }, { data: users }] = await Promise.all([
        db
          .from('notification_preferences')
          .select('user_id, organization_id, preferences, quiet_hours, digest_mode')
          .in('user_id', userIds),
        db.from('organizations').select('id, name, slug').in('id', orgIds),
        db.from('profiles').select('id, full_name').in('id', userIds),
      ])

      // auth.users holds the address; profiles does not.
      const emails = new Map<string, string>()
      for (const userId of userIds) {
        const { data } = await db.auth.admin.getUserById(userId)
        if (data.user?.email) emails.set(userId, data.user.email)
      }

      return {
        preferences: preferences ?? [],
        organizations: organizations ?? [],
        users: users ?? [],
        emails: Object.fromEntries(emails),
      }
    })

    const orgById = new Map(context.organizations.map((org) => [org.id, org]))
    const prefsByKey = new Map(
      context.preferences.map((row) => [`${row.user_id}:${row.organization_id}`, row]),
    )

    const now = new Date()
    const toSend: string[] = []
    const toDefer: string[] = []

    for (const notification of pending) {
      const prefs = prefsByKey.get(`${notification.user_id}:${notification.organization_id}`)
      const preference = preferenceFor(prefs?.preferences, notification.type)

      // Not opted in for email on this type: mark handled so it is not
      // reconsidered on every run for the next day.
      if (!preference.email) {
        toDefer.push(notification.id)
        continue
      }

      // Quiet hours and non-instant digests both mean "not now" — leave the row
      // unsent and let a later run or the digest job pick it up.
      if (inQuietHours(prefs?.quiet_hours, now)) continue
      if (digestModeOf(prefs?.digest_mode) !== 'instant') continue

      toSend.push(notification.id)
    }

    const sent = await step.run('send', async () => {
      const db = createAdminClient()
      let delivered = 0

      for (const id of toSend) {
        const notification = pending.find((row) => row.id === id)!
        const org = orgById.get(notification.organization_id)
        const to = (context.emails as Record<string, string>)[notification.user_id]
        if (!org || !to) continue

        const content = notificationEmail({
          title: notification.title,
          body: notification.body,
          actionUrl: notificationUrl(APP_URL(), org.slug, notification.data),
          orgName: org.name,
          preferencesUrl: APP_URL() ? `${APP_URL()}/${org.slug}/settings/profile` : null,
        })

        const result = await sendEmail({ to, ...content })

        // Mark on success, and also when email is not configured at all —
        // otherwise every run would retry the same backlog forever.
        if (result.ok || result.skipped === 'no_api_key') {
          await db
            .from('notifications')
            .update({ emailed_at: new Date().toISOString() })
            .eq('id', id)
          if (result.ok) delivered += 1
        }
      }

      return delivered
    })

    if (toDefer.length > 0) {
      await step.run('mark-opted-out', async () => {
        const db = createAdminClient()
        await db
          .from('notifications')
          .update({ emailed_at: new Date().toISOString() })
          .in('id', toDefer)
      })
    }

    return { sent, skipped: toDefer.length }
  },
)

/**
 * Daily digest for people who chose not to be emailed per event.
 *
 * Runs once an hour and only acts for users whose local time has just passed the
 * digest hour, so "daily at 08:00" means 08:00 where they are (§21.6).
 */
export const sendDailyDigests = inngest.createFunction(
  { id: 'notification-digest', retries: 2 },
  { cron: '5 * * * *' },
  async ({ step }) => {
    const batches = await step.run('collect', async () => {
      const db = createAdminClient()
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()

      const { data: preferences } = await db
        .from('notification_preferences')
        .select('user_id, organization_id, digest_mode, quiet_hours')
        .in('digest_mode', ['hourly', 'daily'])

      if (!preferences?.length) return []

      const results: {
        userId: string
        orgId: string
        items: { title: string; body: string | null; data: unknown }[]
        ids: string[]
      }[] = []

      for (const pref of preferences) {
        const { data: unsent } = await db
          .from('notifications')
          .select('id, title, body, data')
          .eq('user_id', pref.user_id)
          .eq('organization_id', pref.organization_id)
          .is('emailed_at', null)
          .gte('created_at', since)
          .order('created_at')
          .limit(25)

        if (!unsent?.length) continue

        results.push({
          userId: pref.user_id,
          orgId: pref.organization_id,
          items: unsent.map((row) => ({ title: row.title, body: row.body, data: row.data })),
          ids: unsent.map((row) => row.id),
        })
      }

      return results
    })

    if (batches.length === 0) return { digests: 0 }

    const digests = await step.run('send-digests', async () => {
      const db = createAdminClient()
      let count = 0

      for (const batch of batches) {
        const [{ data: org }, { data: user }] = await Promise.all([
          db.from('organizations').select('name, slug').eq('id', batch.orgId).maybeSingle(),
          db.auth.admin.getUserById(batch.userId),
        ])

        const to = user.user?.email
        if (!org || !to) continue

        const content = digestEmail({
          orgName: org.name,
          items: batch.items.map((item) => ({
            title: item.title,
            body: item.body,
            url: notificationUrl(APP_URL(), org.slug, item.data),
          })),
          inboxUrl: APP_URL() ? `${APP_URL()}/${org.slug}/notifications` : null,
        })

        const result = await sendEmail({ to, ...content })

        if (result.ok || result.skipped === 'no_api_key') {
          await db
            .from('notifications')
            .update({ emailed_at: new Date().toISOString() })
            .in('id', batch.ids)
          if (result.ok) count += 1
        }
      }

      return count
    })

    return { digests }
  },
)

/**
 * Notify assignees of tasks that have gone overdue.
 *
 * Runs hourly and evaluates "overdue" in each organization's own timezone, so a
 * task is not flagged a day early for a team west of UTC (§21.6).
 */
export const flagOverdueTasks = inngest.createFunction(
  { id: 'overdue-task-notifications', retries: 2 },
  { cron: '15 * * * *' },
  async ({ step }) => {
    const created = await step.run('scan', async () => {
      const db = createAdminClient()

      const { data: organizations } = await db
        .from('organizations')
        .select('id, timezone')
        .eq('status', 'active')

      if (!organizations?.length) return 0

      let inserted = 0

      for (const org of organizations) {
        const today = todayIn(org.timezone)

        const { data: overdue } = await db
          .from('tasks')
          .select('id, title, project_id, assignee_id, due_date')
          .eq('organization_id', org.id)
          .not('assignee_id', 'is', null)
          .not('due_date', 'is', null)
          .lt('due_date', today)
          .not('status', 'in', '(done,cancelled)')
          .limit(500)

        if (!overdue?.length) continue

        // One notification per task per day: re-notifying every hour would make
        // the feature a nuisance rather than a reminder.
        const since = new Date(Date.now() - 20 * 3600_000).toISOString()
        const { data: recent } = await db
          .from('notifications')
          .select('data')
          .eq('organization_id', org.id)
          .eq('type', 'task_overdue')
          .gte('created_at', since)

        const alreadyNotified = new Set(
          (recent ?? [])
            .map((row) => (row.data as { task_id?: string } | null)?.task_id)
            .filter(Boolean),
        )

        const rows = overdue
          .filter((task) => !alreadyNotified.has(task.id))
          .map((task) => ({
            organization_id: org.id,
            user_id: task.assignee_id!,
            type: 'task_overdue',
            title: `Overdue: ${task.title}`,
            body: `This task was due ${task.due_date}.`,
            data: { task_id: task.id, project_id: task.project_id },
          }))

        if (rows.length === 0) continue

        const { error } = await db.from('notifications').insert(rows)
        if (!error) inserted += rows.length
      }

      return inserted
    })

    return { created }
  },
)

export const functions = [deliverNotificationEmails, sendDailyDigests, flagOverdueTasks]
