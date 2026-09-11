import 'server-only'

import type { Database } from '@pm/db/types'
import { publicIdToString } from '@pm/shared/utils'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/client'
import { addedToProjectsEmail } from '@/lib/email/templates'
import { digestModeOf, inQuietHours, preferenceFor } from '@/lib/inngest/notifications'
import { createAdminClient } from '@/lib/supabase/admin'

type Db = SupabaseClient<Database>

export interface GrantedProject {
  id: string
  name: string
  /** Built from the public id and the workspace slug, so it is a real link. */
  url: string | null
}

/**
 * Project membership, granted and announced.
 *
 * One place rather than three, because "add someone to a project" happens from
 * the invite dialog, from the member access dialog and from the project's own
 * members panel, and every one of them owes the person the same notification.
 *
 * The caller supplies the client. The invite path holds a service-role client
 * (it is acting on a user who has not signed in yet and has no session to speak
 * through); the edit path holds the caller's own, where RLS already restricts
 * project membership writes to manager and above. Either way `organizationId`
 * is applied explicitly, because a service-role client bypasses RLS and an id
 * that arrived in a form must never be trusted to belong to this tenant.
 */
export async function grantProjectAccess(
  db: Db,
  input: {
    organizationId: string
    orgSlug: string
    userId: string
    projectIds: string[]
    /** Whoever is doing the granting; null when a job is. */
    actorId: string | null
    actorName: string | null
    orgName: string
    appUrl: string
    /** Skip the email — the invite flow sends one message covering everything. */
    notify?: boolean
    /** The recipient's address when the caller already knows it. */
    recipientEmail?: string | null
  },
): Promise<GrantedProject[]> {
  const { projectIds, organizationId, userId } = input
  if (projectIds.length === 0) return []

  // Resolve and tenant-check in one query: anything not returned here either
  // does not exist or belongs to another organization, and is silently dropped
  // rather than reported — the ids came from a picker, not from a person.
  const { data: projects } = await db
    .from('projects')
    .select('id, name, public_id, workspace:workspaces!projects_workspace_id_fkey(slug)')
    .eq('organization_id', organizationId)
    .in('id', projectIds)

  if (!projects?.length) return []

  // Only announce what is genuinely new. Re-saving the access dialog without
  // changing anything must not send another round of "you were added" mail.
  const { data: existing } = await db
    .from('project_members')
    .select('project_id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .in(
      'project_id',
      projects.map((project) => project.id),
    )

  const already = new Set((existing ?? []).map((row) => row.project_id))
  const fresh = projects.filter((project) => !already.has(project.id))
  if (fresh.length === 0) return []

  const { error } = await db.from('project_members').insert(
    fresh.map((project) => ({
      project_id: project.id,
      user_id: userId,
      organization_id: organizationId,
      role: 'contributor' as const,
    })),
  )
  // A unique violation means someone was added by another path between the
  // read above and this write; that is the desired end state, not a failure.
  if (error && error.code !== '23505') throw error

  const granted: GrantedProject[] = fresh.map((project) => {
    const workspace = Array.isArray(project.workspace) ? project.workspace[0] : project.workspace
    const publicId = publicIdToString(project.public_id)
    return {
      id: project.id,
      name: project.name,
      url:
        workspace?.slug && publicId
          ? `${input.appUrl}/${input.orgSlug}/${workspace.slug}/projects/${publicId}/list`
          : null,
    }
  })

  if (input.notify === false) return granted

  await notifyProjectAccess({
    organizationId,
    userId,
    actorName: input.actorName,
    orgName: input.orgName,
    granted,
    recipientEmail: input.recipientEmail,
  })

  return granted
}

/**
 * The in-app row and the email for a set of fresh grants.
 *
 * Neither is allowed to fail the grant that caused it: access has already been
 * written by the time this runs, and an SMTP hiccup that surfaced as an error
 * would leave the caller believing nothing happened while the person quietly
 * has access.
 */
export async function notifyProjectAccess(input: {
  organizationId: string
  userId: string
  actorName: string | null
  orgName: string
  granted: GrantedProject[]
  /** Known address; looked up only when absent. */
  recipientEmail?: string | null
}): Promise<void> {
  if (input.granted.length === 0) return

  const names = input.granted.map((project) => project.name)
  const title =
    names.length === 1
      ? `You were added to ${names[0]}`
      : `You were added to ${names.length} projects`

  // The service role, and only from here down. Everything a notification needs
  // belongs to the RECIPIENT, and RLS quite rightly hides all of it from the
  // person doing the granting: `notification_preferences` is readable only by
  // its owner, and `notifications` has no INSERT policy at all, because nobody
  // should be able to write into someone else's inbox. Writing a notification
  // is a system action, so it is done as the system (§13.10).
  const admin = createAdminClient()

  // The recipient's own settings decide whether mail goes out at all, and when.
  // `notifications` is the queue the delivery cron drains, so writing the row
  // and emailing it here without saying so would send the same thing twice —
  // `emailed_at` is the flag that stops that.

  const { data: prefs } = await admin
    .from('notification_preferences')
    .select('preferences, quiet_hours, digest_mode')
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId)
    .maybeSingle()

  const preference = preferenceFor(prefs?.preferences, 'project_invite')
  const deferred =
    inQuietHours(prefs?.quiet_hours, new Date()) || digestModeOf(prefs?.digest_mode) !== 'instant'

  // Send here rather than leaving it to the cron whenever we can: this message
  // names the projects and links straight to one, which the generic
  // notification template cannot do. Quiet hours and digest modes still win —
  // those rows are left for the job that honours them.
  const shouldEmailNow = preference.email && !deferred
  const email = shouldEmailNow
    ? (input.recipientEmail ?? (await addressFor(admin, input.userId)))
    : null

  let emailedAt: string | null = null
  if (email) {
    const result = await sendEmail({
      to: email,
      ...addedToProjectsEmail({
        orgName: input.orgName,
        actorName: input.actorName,
        projectNames: names,
        projectUrl: input.granted[0]?.url ?? null,
      }),
    })
    // Stamped on a refusal that will not change too — no key, unroutable
    // address — so the cron does not retry the same message for a day.
    if (result.ok || result.skipped) emailedAt = new Date().toISOString()
  } else if (!preference.email) {
    // Opted out of email for this type: record it as handled so the cron does
    // not reconsider the row on every run.
    emailedAt = new Date().toISOString()
  }

  try {
    await admin.from('notifications').insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      type: 'project_invite',
      title,
      body: input.actorName ? `${input.actorName} gave you access.` : null,
      data: {
        project_ids: input.granted.map((project) => project.id),
        project_names: names,
        url: input.granted[0]?.url ?? null,
      },
      emailed_at: emailedAt,
    })
  } catch {
    // In-app delivery is best effort — access has already been granted, and an
    // error here must not undo that.
  }
}

/**
 * The member's address, when the caller did not already have it.
 *
 * Goes through the admin auth API rather than `org_member_directory`: that
 * function reads its tenant from the JWT, and a service-role client has no
 * claims, so it would return nothing here. The tenant check is not lost — the
 * only user ids that reach this point came from a project membership row that
 * was already scoped to the organization.
 */
async function addressFor(admin: Db, userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId)
  return data.user?.email ?? null
}
