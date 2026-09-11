import 'server-only'

import { chooseAssignee, ruleFor, type AssignmentRule, type Candidate } from '@pm/db'
import { isDue, parseSchedule, resolveProjectSettings, slotKey } from '@pm/shared/constants'
import { addDaysToDateString, todayIn } from '@pm/shared/utils'
import { appUrl } from '@/lib/app-url'
import { sendEmail } from '@/lib/email/client'
import { digestEmail, notificationEmail } from '@/lib/email/templates'
import { notify } from '@/lib/notifications/deliver'
import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from './client'
import { dispatchIntegrationEvents } from './integration-dispatch'
import {
  digestModeOf,
  inQuietHours,
  notificationUrl,
  preferenceFor,
} from './notifications'
import { executeWorkflow } from './workflow-execute'
import { triggerMatches } from './workflow-runner'

/**
 * Background jobs (§3, §12).
 *
 * All of these run as service_role and therefore bypass RLS — every query below
 * scopes itself explicitly (§13.10). None of them accept tenant ids from an
 * untrusted caller; they read the rows they are about to act on.
 */



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

      const [
        { data: preferences },
        { data: organizations },
        { data: users },
        { data: projectPreferences },
      ] = await Promise.all([
        db
          .from('notification_preferences')
          .select('user_id, organization_id, preferences, quiet_hours, digest_mode')
          .in('user_id', userIds),
        db.from('organizations').select('id, name, slug').in('id', orgIds),
        db.from('profiles').select('id, full_name').in('id', userIds),
        // Per-project overrides (migration 00043). Loaded here rather than in
        // the loop so a backlog of 100 notifications is still one query, and
        // because notifications written by DATABASE TRIGGERS — assignment,
        // mentions — arrive through this job and must honour the same project
        // mute the in-app panel offers. Without this, muting a project would
        // silence the inbox but keep emailing.
        db
          .from('project_notification_preferences')
          .select('user_id, project_id, preferences, muted')
          .in('user_id', userIds),
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
        projectPreferences: projectPreferences ?? [],
      }
    })

    const orgById = new Map(context.organizations.map((org) => [org.id, org]))
    const prefsByKey = new Map(
      context.preferences.map((row) => [`${row.user_id}:${row.organization_id}`, row]),
    )

    const projectPrefsByKey = new Map(
      context.projectPreferences.map((row) => [`${row.user_id}:${row.project_id}`, row]),
    )

    const now = new Date()
    const toSend: string[] = []
    const toDefer: string[] = []

    for (const notification of pending) {
      const prefs = prefsByKey.get(`${notification.user_id}:${notification.organization_id}`)
      const preference = preferenceFor(prefs?.preferences, notification.type)

      // The project override wins where it has an opinion. A muted project
      // stops email outright; otherwise only the channels it names are
      // replaced, so a project row saying nothing about this type falls back to
      // the organization answer rather than resetting it.
      const projectId = (notification.data as { project_id?: string } | null)?.project_id
      const projectPrefs = projectId
        ? projectPrefsByKey.get(`${notification.user_id}:${projectId}`)
        : undefined

      const override = projectPrefs?.preferences
        ? (projectPrefs.preferences as Record<string, { email?: boolean } | undefined>)[
            notification.type
          ]
        : undefined

      const wantsEmail = projectPrefs?.muted ? false : (override?.email ?? preference.email)

      // Not opted in for email on this type: mark handled so it is not
      // reconsidered on every run for the next day.
      if (!wantsEmail) {
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

        /*
         * No address, or no organization: there is nothing to send and nothing
         * that will change on the next run either — a user whose auth record
         * cannot be read will not start resolving in five minutes.
         *
         * `continue` alone left the row unstamped, so every subsequent run
         * re-selected it, re-queried the auth API for it, and skipped it again,
         * forever. Observed doing exactly that: sixteen consecutive runs on one
         * unresolvable user. Stamping it retires the row the same way an opted
         * -out notification is retired — the in-app copy is unaffected and is
         * still the durable record.
         */
        if (!org || !to) {
          await db
            .from('notifications')
            .update({ emailed_at: new Date().toISOString() })
            .eq('id', id)
          continue
        }

        const content = notificationEmail({
          title: notification.title,
          body: notification.body,
          actionUrl: notificationUrl(appUrl(), org.slug, notification.data),
          orgName: org.name,
          preferencesUrl: appUrl() ? `${appUrl()}/${org.slug}/settings/profile` : null,
        })

        const result = await sendEmail({ to, ...content })

        // Mark on success, and also when the send was refused for a reason
        // that will not change — no key, or an address that can never receive
        // mail. Otherwise every run retries the same backlog forever.
        if (result.ok || result.skipped) {
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
            url: notificationUrl(appUrl(), org.slug, item.data),
          })),
          inboxUrl: appUrl() ? `${appUrl()}/${org.slug}/notifications` : null,
        })

        const result = await sendEmail({ to, ...content })

        if (result.ok || result.skipped) {
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
 * Due-date reminders: tomorrow, today, and overdue (§19).
 *
 * Runs hourly and evaluates the date in each organization's own timezone, so a
 * task is not flagged a day early for a team west of UTC (§21.6).
 *
 * The brief was explicit that overdue must not become daily spam. Each of the
 * three states is therefore notified ONCE per task — the dedupe key names the
 * task and the state, not the day, so "overdue" fires when a task crosses the
 * line and then stays quiet however long it sits there. Moving the due date
 * produces a new state and a new reminder, which is the behaviour people
 * actually expect.
 */
export const flagOverdueTasks = inngest.createFunction(
  { id: 'due-date-notifications', retries: 2 },
  { cron: '15 * * * *' },
  async ({ step }) => {
    const created = await step.run('scan', async () => {
      const db = createAdminClient()

      /*
       * Every organization still entitled to reminders — which is not the same
       * as `status = 'active'`.
       *
       * A TRIAL org is a customer using the product right now, and the old
       * filter silently excluded them: every trial team got zero due-date
       * reminders, with nothing to show for it because a notification that is
       * never written leaves no trace. Only suspended and churned tenants
       * should go quiet, so the filter names those rather than allow-listing
       * one status and forgetting the rest exist.
       */
      const { data: organizations } = await db
        .from('organizations')
        .select('id, slug, timezone')
        .not('status', 'in', '(suspended,churned)')

      if (!organizations?.length) return 0

      let inserted = 0

      for (const org of organizations) {
        const today = todayIn(org.timezone)
        const tomorrow = addDaysToDateString(today, 1)

        const { data: due } = await db
          .from('tasks')
          .select(
            'id, public_id, title, project_id, assignee_id, assigner_id, due_date, project:projects!tasks_project_id_fkey(public_id, workspace:workspaces!projects_workspace_id_fkey(slug))',
          )
          .eq('organization_id', org.id)
          .not('assignee_id', 'is', null)
          .not('due_date', 'is', null)
          .lte('due_date', tomorrow)
          .not('status', 'in', '(done,cancelled)')
          .limit(500)

        if (!due?.length) continue

        for (const task of due) {
          const state =
            task.due_date! < today ? 'overdue' : task.due_date === today ? 'today' : 'tomorrow'

          const project = Array.isArray(task.project) ? task.project[0] : task.project
          const workspace = project
            ? Array.isArray(project.workspace)
              ? project.workspace[0]
              : project.workspace
            : null

          const url =
            appUrl() && workspace?.slug && project?.public_id
              ? `${appUrl()}/${org.slug}/${workspace.slug}/projects/${project.public_id}/tasks/${task.public_id}`
              : null

          const copy = {
            overdue: {
              type: 'task_overdue',
              title: `Overdue: ${task.title}`,
              body: `This was due ${task.due_date}.`,
            },
            today: {
              type: 'task_due_today',
              title: `Due today: ${task.title}`,
              body: null,
            },
            tomorrow: {
              type: 'task_due_tomorrow',
              title: `Due tomorrow: ${task.title}`,
              body: `Due ${task.due_date}.`,
            },
          }[state]

          await notify({
            orgId: org.id,
            orgSlug: org.slug,
            userId: task.assignee_id!,
            type: copy.type,
            title: copy.title,
            body: copy.body,
            url,
            projectId: task.project_id,
            data: { task_id: task.id },
            // The due date is part of the key: rescheduling a task genuinely is
            // a new reminder, while leaving it alone stays silent.
            dedupeKey: `${task.id}:${state}:${task.due_date}`,
            // Long enough that a task sitting overdue for a fortnight is
            // mentioned once, not fourteen times.
            dedupeWindowHours: 24 * 30,
          })

          inserted += 1
        }
      }

      return inserted
    })

    return { created }
  },
)

/**
 * Apply auto-assignment rules to unassigned tasks (§19.6).
 *
 * Polls rather than reacting to an event: tasks are written by several paths
 * (the board, quick capture, the API), and `emit_event` fires a database
 * trigger that cannot reach Inngest. Scanning for unassigned tasks catches all
 * of them and is naturally idempotent — a task that already has an assignee is
 * simply not a candidate, so a retry cannot reassign it.
 */
export const applyAutoAssignment = inngest.createFunction(
  { id: 'auto-assignment', retries: 2 },
  { cron: '*/2 * * * *' },
  async ({ step }) => {
    const work = await step.run('scan', async () => {
      const db = createAdminClient()
      // Only recent tasks: a rule added today should not retroactively assign
      // everything that has ever been left unassigned on purpose.
      const since = new Date(Date.now() - 60 * 60_000).toISOString()

      const { data: rules } = await db
        .from('auto_assignment_rules')
        .select('id, name, project_id, method, assignee_pool, conditions, config, organization_id')
        .eq('is_active', true)

      if (!rules?.length) return { assigned: 0, considered: 0 }

      const orgIds = [...new Set(rules.map((rule) => rule.organization_id))]

      const { data: tasks } = await db
        .from('tasks')
        .select('id, project_id, priority, organization_id, task_labels(label:labels(name))')
        .in('organization_id', orgIds)
        .is('assignee_id', null)
        .not('status', 'in', '(done,cancelled)')
        .gte('created_at', since)
        .limit(200)

      if (!tasks?.length) return { assigned: 0, considered: 0 }

      let assigned = 0

      for (const orgId of orgIds) {
        const orgRules: AssignmentRule[] = rules
          .filter((rule) => rule.organization_id === orgId)
          .map((rule) => ({
            id: rule.id,
            name: rule.name,
            projectId: rule.project_id,
            method: rule.method as AssignmentRule['method'],
            assigneePool: (rule.assignee_pool ?? []) as string[],
            conditions: (rule.conditions ?? {}) as Record<string, unknown>,
            config: (rule.config ?? {}) as Record<string, unknown>,
          }))

        const orgTasks = tasks.filter((task) => task.organization_id === orgId)
        if (orgTasks.length === 0) continue

        // Everyone any rule in this org could assign to.
        const poolIds = [...new Set(orgRules.flatMap((rule) => rule.assigneePool))]
        if (poolIds.length === 0) continue

        const today = new Date().toISOString().slice(0, 10)

        const [
          { data: openCounts },
          { data: employees },
          { data: leave },
          { data: orgMembers },
          { data: projectMembers },
          { data: projectRows },
        ] = await Promise.all([
          db
            .from('tasks')
            .select('assignee_id')
            .eq('organization_id', orgId)
            .in('assignee_id', poolIds)
            .not('status', 'in', '(done,cancelled)'),
          db.from('employees').select('user_id, skills').eq('organization_id', orgId),
          db
            .from('leave_requests')
            .select('employee:employees!leave_requests_employee_id_fkey(user_id)')
            .eq('organization_id', orgId)
            .eq('status', 'approved')
            .lte('start_date', today)
            .gte('end_date', today),
          // Rank decides members-first; project membership decides eligibility
          // at all. Both are per-org lookups, so they join the same wave.
          db.from('org_members').select('user_id, role').eq('organization_id', orgId),
          db
            .from('project_members')
            .select('user_id, project_id')
            .eq('organization_id', orgId)
            .in('user_id', poolIds),
          // The project's own auto-assignment policy.
          db
            .from('projects')
            .select('id, settings')
            .eq('organization_id', orgId)
            .in(
              'id',
              [...new Set(orgTasks.map((candidate) => candidate.project_id))],
            ),
        ])

        const load = new Map<string, number>()
        for (const row of openCounts ?? []) {
          if (!row.assignee_id) continue
          load.set(row.assignee_id, (load.get(row.assignee_id) ?? 0) + 1)
        }

        const skills = new Map<string, string[]>()
        for (const employee of employees ?? []) {
          skills.set(
            employee.user_id,
            (employee.skills ?? []).map((skill) => skill.toLowerCase()),
          )
        }

        const away = new Set<string>()
        for (const row of leave ?? []) {
          const employee = Array.isArray(row.employee) ? row.employee[0] : row.employee
          if (employee?.user_id) away.add(employee.user_id)
        }

        const roleByUser = new Map(
          (orgMembers ?? []).map((row) => [row.user_id, row.role as Candidate['orgRole']]),
        )

        // Keyed by project, because "is this person on the project?" has a
        // different answer per task.
        const projectMembership = new Map<string, Set<string>>()
        for (const row of projectMembers ?? []) {
          const set = projectMembership.get(row.project_id) ?? new Set<string>()
          set.add(row.user_id)
          projectMembership.set(row.project_id, set)
        }

        const policyByProject = new Map(
          (projectRows ?? []).map((row) => {
            const settings = resolveProjectSettings(row.settings)
            return [
              row.id,
              { autoAssign: settings.autoAssign, autoAssignManagers: settings.autoAssignManagers },
            ]
          }),
        )

        // Built per task rather than once, since project membership varies.
        const candidatesFor = (projectId: string): Candidate[] => {
          const onProject = projectMembership.get(projectId) ?? new Set<string>()
          return poolIds.map((userId) => ({
            userId,
            openTasks: load.get(userId) ?? 0,
            skills: skills.get(userId) ?? [],
            onLeave: away.has(userId),
            isProjectMember: onProject.has(userId),
            orgRole: roleByUser.get(userId) ?? 'member',
          }))
        }

        for (const task of orgTasks) {
          const labelNames = ((task.task_labels ?? []) as { label: { name: string } | null }[])
            .map((row) => (Array.isArray(row.label) ? row.label[0] : row.label))
            .map((label) => label?.name)
            .filter((name): name is string => Boolean(name))

          const candidateTask = {
            id: task.id,
            projectId: task.project_id,
            priority: task.priority,
            labelNames,
          }

          const rule = ruleFor(orgRules, candidateTask)
          if (!rule) continue

          // Rebuilt per task: eligibility depends on the project, and the
          // batch's running load is carried in `load` rather than on these
          // short-lived objects.
          const candidates = candidatesFor(task.project_id)
          const policy = policyByProject.get(task.project_id) ?? {
            autoAssign: true,
            autoAssignManagers: true,
          }

          const decision = chooseAssignee(rule, candidateTask, candidates, Math.random, policy)
          if (!decision) continue

          const { error } = await db
            .from('tasks')
            .update({ assignee_id: decision.userId })
            .eq('id', task.id)
            // Re-check emptiness at write time: someone may have assigned it by
            // hand between the scan and now.
            .is('assignee_id', null)

          if (error) continue

          assigned += 1

          // Keep the running load current so a batch does not hand every task
          // to the same person. Written to the map, not to the candidate
          // objects — those are rebuilt for the next task and would lose it.
          load.set(decision.userId, (load.get(decision.userId) ?? 0) + 1)

          if (decision.nextConfig) {
            rule.config = decision.nextConfig
            await db
              .from('auto_assignment_rules')
              .update({ config: decision.nextConfig as never })
              .eq('id', rule.id)
          }
        }
      }

      return { assigned, considered: tasks.length }
    })

    return work
  },
)

/**
 * Dispatch events to workflows (§11, §12).
 *
 * Polls the `events` table rather than reacting to an Inngest event, because
 * events are written by the `emit_event` database trigger and Postgres cannot
 * call Inngest. `events.processed` is deliberately NOT used as the cursor: it is
 * a single shared boolean and the integration dispatcher is meant to read the
 * same rows, so consuming it here would starve that.
 *
 * Idempotency comes from the unique index on
 * (workflow_id, trigger_data->>'event_id') added in 00024 — a retried poll gets
 * a unique violation and skips, rather than firing the actions twice.
 */
export const dispatchWorkflows = inngest.createFunction(
  { id: 'workflow-dispatch', retries: 2 },
  { cron: '*/2 * * * *' },
  async ({ step }) => {
    const result = await step.run('dispatch', async () => {
      const db = createAdminClient()
      // A window, not a cursor: anything older has either been handled or is
      // not worth firing a side effect for now.
      const since = new Date(Date.now() - 15 * 60_000).toISOString()

      const { data: workflows } = await db
        .from('workflows')
        .select('id, organization_id, workspace_id, name, trigger_type, trigger_config, graph')
        .eq('is_active', true)
        .in('trigger_type', ['task_event', 'subtask_event', 'commercial_event'])

      if (!workflows?.length) return { queued: [], events: 0 }

      const orgIds = [...new Set(workflows.map((workflow) => workflow.organization_id))]

      const { data: events } = await db
        .from('events')
        .select('id, organization_id, event_type, payload')
        .in('organization_id', orgIds)
        .gte('created_at', since)
        .order('created_at')
        .limit(500)

      if (!events?.length) return { queued: [], events: 0 }

      // Matching happens here; running happens in `executeWorkflow`. Keeping
      // them apart is what lets a run suspend on a delay — a poll cannot wait
      // three days for a workflow to finish.
      const queued: {
        workflow_id: string
        trigger: { id: string; eventType: string; payload: Record<string, unknown> }
      }[] = []

      for (const event of events) {
        const trigger = {
          id: event.id,
          eventType: event.event_type,
          payload: (event.payload ?? {}) as Record<string, unknown>,
        }

        for (const workflow of workflows) {
          if (workflow.organization_id !== event.organization_id) continue

          const config = (workflow.trigger_config ?? {}) as Record<string, unknown>
          if (!triggerMatches(workflow.trigger_type, config, trigger)) continue

          queued.push({ workflow_id: workflow.id, trigger })
        }
      }

      return { queued, events: events.length }
    })

    if (result.queued.length > 0) {
      await step.sendEvent(
        'run-workflows',
        result.queued.map((data) => ({ name: 'workflow/run' as const, data })),
      )
    }

    return { runs: result.queued.length, events: result.events }
  },
)

/**
 * Fire schedule-triggered workflows (§11).
 *
 * Inngest functions are declared statically, so there is no way to register one
 * cron per workflow. Instead this polls often and asks each scheduled workflow
 * whether its moment has passed, in the organisation's timezone (§21.6).
 *
 * The slot key, not `last_run_at`, is what prevents a double fire. Comparing
 * elapsed time would drift: a poll that lands a minute late would push every
 * subsequent run a minute later, forever.
 */
export const runScheduledWorkflows = inngest.createFunction(
  { id: 'workflow-schedule', retries: 2 },
  { cron: '*/5 * * * *' },
  async ({ step }) => {
    const due = await step.run('find-due', async () => {
      const db = createAdminClient()

      const { data: workflows } = await db
        .from('workflows')
        .select('id, organization_id, trigger_config, last_scheduled_slot')
        .eq('is_active', true)
        .eq('trigger_type', 'schedule')

      if (!workflows?.length) return []

      const orgIds = [...new Set(workflows.map((workflow) => workflow.organization_id))]
      const { data: orgs } = await db
        .from('organizations')
        .select('id, timezone')
        .in('id', orgIds)

      const zoneFor = new Map((orgs ?? []).map((org) => [org.id, org.timezone || 'UTC']))
      const now = new Date()
      const ready: { id: string; slot: string }[] = []

      for (const workflow of workflows) {
        const zone = zoneFor.get(workflow.organization_id) ?? 'UTC'
        const config = (workflow.trigger_config ?? {}) as { schedule?: unknown }
        const schedule = parseSchedule(config.schedule)
        const slot = slotKey(schedule, now, zone)

        // The stored slot is the authority. isDue also compares against
        // last_run_at, but a run that failed still consumed its occurrence.
        if (workflow.last_scheduled_slot === slot) continue
        if (!isDue(schedule, now, null, zone)) continue

        ready.push({ id: workflow.id, slot })
      }

      // Claim the slot before dispatching. If the send fails, the occurrence is
      // lost rather than repeated — for a scheduled side effect that is the
      // safer direction.
      for (const entry of ready) {
        await db
          .from('workflows')
          .update({ last_scheduled_slot: entry.slot })
          .eq('id', entry.id)
          .or(`last_scheduled_slot.is.null,last_scheduled_slot.neq.${entry.slot}`)
      }

      return ready
    })

    if (due.length > 0) {
      await step.sendEvent(
        'run-scheduled',
        due.map((entry) => ({
          name: 'workflow/run' as const,
          data: {
            workflow_id: entry.id,
            trigger: {
              id: `schedule:${entry.id}:${entry.slot}`,
              eventType: 'workflow.scheduled',
              payload: { source: 'schedule', slot: entry.slot },
            },
          },
        })),
      )
    }

    return { fired: due.length }
  },
)

export const functions = [
  deliverNotificationEmails,
  sendDailyDigests,
  flagOverdueTasks,
  applyAutoAssignment,
  dispatchWorkflows,
  runScheduledWorkflows,
  executeWorkflow,
  dispatchIntegrationEvents,
]
