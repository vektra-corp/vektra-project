'use server'

import { canManageRole, hasPermission, isAtLeast } from '@pm/auth/rbac'
import type { OrgRole } from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import {
  fieldErrors,
  inviteMemberSchema,
  memberAccessSchema,
  memberRoleUpdateSchema,
} from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { grantProjectAccess } from '@/lib/access/project-access'
import { toActionError } from '@/lib/action-error'
import { appUrl, appUrlProblem } from '@/lib/app-url'
import { requireAuth } from '@/lib/auth/context'
import { sendEmail } from '@/lib/email/client'
import { addedToOrgEmail, inviteEmail } from '@/lib/email/templates'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Organization membership.
 *
 * Role changes go through `canManageRole`, which enforces the rules the matrix
 * alone cannot: you may not act on someone at or above your own rank, may not
 * grant a role above your own, and ownership never moves through this path.
 */

function membersPath(orgSlug: string) {
  return `/${orgSlug}/members`
}

export interface InviteResult {
  email: string
  /** False when mail is not configured, or the address could not be delivered to. */
  emailed: boolean
  /** Why the mail did not go, in the provider's own words. */
  emailError?: string
  /**
   * The accept link, returned ONLY when the mail failed and the account is new.
   *
   * An invitation that cannot be emailed is otherwise a dead end: the person has
   * a membership row and no way to reach it. Handing the link back lets the
   * inviter pass it on themselves. It is not returned on success, so the normal
   * path never puts a single-use credential on a screen.
   */
  acceptUrl?: string
  /** Projects the invitee was placed into, for the confirmation copy. */
  projectNames: string[]
}

/**
 * Invite someone to the organization.
 *
 * Uses the service-role client for exactly two things — looking up whether the
 * email already has an account, and minting the invite link — because both are
 * `auth.users` operations that RLS cannot express. Every tenant write below it
 * is still scoped to the caller's own `orgId`, explicitly (§13.10).
 *
 * The mail is sent by this app, not by Supabase Auth. `generateLink` produces
 * the link without sending anything, so the message can name the inviter, the
 * organization and the role — the three facts the reader needs and the stock
 * "you have been invited" template cannot know. It also means an existing
 * account gets a different, correct message: there is nothing for them to
 * accept and no password for them to set.
 */
export async function inviteMember(
  orgSlug: string,
  _prevState: ActionResult<InviteResult> | null,
  formData: FormData,
): Promise<ActionResult<InviteResult>> {
  const auth = await requireAuth(orgSlug)

  const role = String(formData.get('role') ?? 'member') as OrgRole
  // An inviter cannot create someone senior to themselves.
  if (!canManageRole(auth.orgRole, 'member', role)) {
    return { ok: false, code: 'FORBIDDEN', message: 'You cannot grant that role.' }
  }

  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    role,
    workspace_ids: formData.getAll('workspace_ids').map(String).filter(Boolean),
    project_ids: formData.getAll('project_ids').map(String).filter(Boolean),
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  // Refuse before creating anything. An invitation whose link cannot be opened
  // is worse than no invitation: it creates the membership, consumes the one
  // token, and leaves the recipient stuck — with the sender believing it worked.
  const urlProblem = appUrlProblem()
  if (urlProblem) {
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: `This deployment is misconfigured: ${urlProblem} Ask an administrator to set it before inviting anyone.`,
    }
  }

  const admin = createAdminClient()
  const origin = appUrl()

  try {
    // Reuse an existing account when the person already has one, so inviting a
    // colleague who is in another org adds a membership rather than failing.
    const { data: existing } = await admin.rpc('user_id_for_email', {
      p_email: parsed.data.email,
    })

    let userId = existing as string | null
    let acceptUrl: string | null = null

    // Someone who has an account but no usable credential still cannot sign in:
    // they were invited somewhere else and never finished, or their accept flow
    // broke half way. Adding them silently and mailing "sign in with your
    // existing account" would be advice they cannot act on, so they get a fresh
    // accept link like a new account does.
    //
    // Asked in the database rather than through the admin API, which reports
    // `last_sign_in_at` but nothing about whether a password was ever set —
    // and Supabase stamps that timestamp when the emailed token is consumed,
    // one screen BEFORE the password is chosen.
    let needsPassword = !userId
    if (userId) {
      const { data: stuck } = await admin.rpc('user_needs_password', {
        p_email: parsed.data.email,
      })
      needsPassword = stuck !== false
    }

    if (needsPassword) {
      // The link lands on /accept-invite, which is where they set a password —
      // without that step the account has none and they could never sign in
      // again after this one link expires.
      const link = await mintAcceptLink(admin, parsed.data.email, orgSlug, origin, Boolean(userId))

      if (!link.ok) {
        return { ok: false, code: 'INTERNAL_ERROR', message: link.message }
      }

      userId = link.userId ?? userId
      acceptUrl = link.acceptUrl
    }

    // A magic link for an address with no account can succeed without creating
    // one. Stop here rather than writing a membership row with a null user.
    if (!userId) {
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'Could not create an account for that address.',
      }
    }

    const { error: memberError } = await admin.from('org_members').insert({
      organization_id: auth.orgId,
      user_id: userId,
      role: parsed.data.role,
    })

    if (memberError) {
      if (memberError.code === '23505') {
        return {
          ok: false,
          code: 'ALREADY_EXISTS',
          message: 'That person is already a member of this organization.',
          fieldErrors: { email: ['Already a member of this organization.'] },
        }
      }
      throw memberError
    }

    // A project grant is meaningless without the workspace above it — the
    // sidebar is built from workspace membership — so any workspace implied by
    // a chosen project is added whether or not it was ticked.
    const { data: chosenProjects } = parsed.data.project_ids.length
      ? await admin
          .from('projects')
          .select('id, workspace_id')
          .eq('organization_id', auth.orgId)
          .in('id', parsed.data.project_ids)
      : { data: [] as { id: string; workspace_id: string }[] }

    const workspaceIds = new Set([
      ...parsed.data.workspace_ids,
      ...(chosenProjects ?? []).map((project) => project.workspace_id),
    ])

    if (workspaceIds.size > 0) {
      // Scoped to this org explicitly: the service-role client bypasses RLS, so
      // an id from the form must not be trusted to belong here.
      const { data: workspaces } = await admin
        .from('workspaces')
        .select('id')
        .eq('organization_id', auth.orgId)
        .in('id', [...workspaceIds])

      if (workspaces?.length) {
        await admin.from('workspace_members').insert(
          workspaces.map((workspace) => ({
            workspace_id: workspace.id,
            user_id: userId,
            organization_id: auth.orgId,
            role: 'member' as const,
          })),
        )
      }
    }

    const [{ data: organization }, { data: inviter }] = await Promise.all([
      admin.from('organizations').select('name').eq('id', auth.orgId).maybeSingle(),
      admin.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle(),
    ])

    const orgName = organization?.name ?? 'your team'
    const inviterName = inviter?.full_name ?? null

    // Project membership is what RLS actually reads to open a board, so it is
    // granted here rather than left as a second job for the inviter. `notify`
    // is off: the invitation below already names every project, and a second
    // "you were added to a project" mail to someone who cannot sign in yet
    // would be noise.
    const granted = await grantProjectAccess(admin, {
      organizationId: auth.orgId,
      orgSlug,
      userId,
      projectIds: parsed.data.project_ids,
      actorId: auth.userId,
      actorName: inviterName,
      orgName,
      appUrl: origin,
      notify: false,
    })

    const projectNames = granted.map((project) => project.name)

    // Everything that grants access has succeeded by here. The mail is sent
    // last and its failure is not propagated: a member who exists but was not
    // emailed can be told in person, while an error now would leave the caller
    // believing the invitation did not happen at all. The reason and the link
    // do come back, so the inviter can act on it instead of guessing.
    const message = acceptUrl
      ? inviteEmail({
          orgName,
          inviterName,
          role: parsed.data.role,
          acceptUrl,
          projectNames,
        })
      : addedToOrgEmail({
          orgName,
          inviterName,
          role: parsed.data.role,
          orgUrl: granted[0]?.url ?? `${origin}/${orgSlug}/dashboard`,
          projectNames,
        })

    const delivery = await sendEmail({ to: parsed.data.email, ...message })

    revalidatePath(membersPath(orgSlug))
    return {
      ok: true,
      data: {
        email: parsed.data.email,
        emailed: delivery.ok,
        emailError: delivery.ok ? undefined : describeDelivery(delivery),
        acceptUrl: delivery.ok ? undefined : (acceptUrl ?? undefined),
        projectNames,
      },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/** Turn a send result into something an inviter can act on. */
function describeDelivery(delivery: { skipped?: string; error?: string }): string {
  if (delivery.skipped === 'no_api_key') return 'Email is not configured for this deployment.'
  if (delivery.skipped === 'undeliverable_domain') return 'That address uses a reserved test domain.'
  return delivery.error ?? 'The email provider rejected the message.'
}

export async function updateMemberRole(
  orgSlug: string,
  userId: string,
  nextRole: OrgRole,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  const supabase = createClient()

  const parsed = memberRoleUpdateSchema.safeParse({ user_id: userId, role: nextRole })
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'That role cannot be assigned here.' }
  }

  try {
    const { data: target } = await supabase
      .from('org_members')
      .select('role')
      .eq('organization_id', auth.orgId)
      .eq('user_id', userId)
      .maybeSingle()

    if (!target) return { ok: false, code: 'NOT_FOUND', message: 'That member was not found.' }

    if (!canManageRole(auth.orgRole, target.role as OrgRole, parsed.data.role)) {
      return { ok: false, code: 'FORBIDDEN', message: 'You cannot change that member’s role.' }
    }

    const { error } = await supabase
      .from('org_members')
      .update({ role: parsed.data.role })
      .eq('organization_id', auth.orgId)
      .eq('user_id', userId)

    if (error) throw error

    revalidatePath(membersPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function removeMember(orgSlug: string, userId: string): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)

  // Removing yourself is a "leave organization" flow with different
  // consequences (last-owner checks, redirect); it is not this action.
  if (userId === auth.userId) {
    return { ok: false, code: 'CONFLICT', message: 'You cannot remove yourself here.' }
  }

  const supabase = createClient()

  try {
    const { data: target } = await supabase
      .from('org_members')
      .select('role')
      .eq('organization_id', auth.orgId)
      .eq('user_id', userId)
      .maybeSingle()

    if (!target) return { ok: false, code: 'NOT_FOUND', message: 'That member was not found.' }

    // canManageRole already refuses to touch an owner or a peer; reuse it rather
    // than restating the hierarchy here.
    if (!canManageRole(auth.orgRole, target.role as OrgRole, 'member')) {
      return { ok: false, code: 'FORBIDDEN', message: 'You cannot remove that member.' }
    }

    const { error } = await supabase
      .from('org_members')
      .delete()
      .eq('organization_id', auth.orgId)
      .eq('user_id', userId)

    if (error) throw error

    revalidatePath(membersPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Replace a member's workspace and project access.
 *
 * Declarative rather than incremental — the dialog sends the full intended set
 * and this reconciles to it — so a double submit or a stale tab cannot leave
 * someone half-added. Removals go first so that revoking access is never
 * delayed by the grant half failing.
 *
 * Runs on the caller's own client, not the service role: RLS already limits
 * project membership to manager and above and workspace membership to admin and
 * above, and going through it means the policies are exercised on every call
 * rather than trusted to have been checked here (§2).
 */
export async function updateMemberAccess(
  orgSlug: string,
  input: { userId: string; workspaceIds: string[]; projectIds: string[] },
): Promise<ActionResult<{ addedProjects: string[] }>> {
  const auth = await requireAuth(orgSlug)

  // Managing someone's access is managing them. The role gate is the same one
  // the members screen itself sits behind.
  if (!hasPermission(auth.orgRole, 'users', 'update')) {
    return { ok: false, code: 'FORBIDDEN', message: 'You cannot change access here.' }
  }

  const parsed = memberAccessSchema.safeParse({
    user_id: input.userId,
    workspace_ids: input.workspaceIds,
    project_ids: input.projectIds,
  })
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'That selection is not valid.' }
  }

  const supabase = createClient()

  try {
    const { data: target } = await supabase
      .from('org_members')
      .select('role')
      .eq('organization_id', auth.orgId)
      .eq('user_id', parsed.data.user_id)
      .maybeSingle()

    if (!target) return { ok: false, code: 'NOT_FOUND', message: 'That member was not found.' }

    // An owner's access is not editable from here, for the same reason their
    // role is not: this path must never be able to lock the org's owner out.
    if ((target.role as OrgRole) === 'owner' && parsed.data.user_id !== auth.userId) {
      return { ok: false, code: 'FORBIDDEN', message: 'The owner’s access cannot be changed here.' }
    }

    // Any workspace implied by a chosen project comes along, or the person ends
    // up in a project inside a workspace their sidebar will not show.
    const { data: chosen } = parsed.data.project_ids.length
      ? await supabase
          .from('projects')
          .select('id, workspace_id')
          .eq('organization_id', auth.orgId)
          .in('id', parsed.data.project_ids)
      : { data: [] as { id: string; workspace_id: string }[] }

    const workspaceIds = [
      ...new Set([
        ...parsed.data.workspace_ids,
        ...(chosen ?? []).map((project) => project.workspace_id),
      ]),
    ]

    // --- workspaces -------------------------------------------------------
    //
    // RLS restricts workspace membership to admin and above, while project
    // membership only needs manager. That asymmetry is deliberate — a manager
    // runs projects, an admin decides who is in a workspace at all — but it
    // would strand a manager who puts someone on a project in a workspace they
    // are not yet in.
    //
    // So the two halves differ. An admin reconciles workspaces to exactly what
    // was ticked. A manager cannot remove anyone from a workspace, and may only
    // add the memberships their own project grants imply — written through the
    // service role, with the tenant applied explicitly since that client
    // bypasses RLS (§13.10).
    const canManageWorkspaces = isAtLeast(auth.orgRole, 'admin')

    const impliedWorkspaceIds = [...new Set((chosen ?? []).map((project) => project.workspace_id))]
    const intendedWorkspaceIds = canManageWorkspaces ? workspaceIds : impliedWorkspaceIds
    const workspaceWriter = canManageWorkspaces ? supabase : createAdminClient()

    if (canManageWorkspaces) {
      let removeWorkspaces = supabase
        .from('workspace_members')
        .delete()
        .eq('organization_id', auth.orgId)
        .eq('user_id', parsed.data.user_id)
      if (intendedWorkspaceIds.length > 0) {
        removeWorkspaces = removeWorkspaces.not(
          'workspace_id',
          'in',
          `(${intendedWorkspaceIds.join(',')})`,
        )
      }
      const { error: wsDeleteError } = await removeWorkspaces
      if (wsDeleteError) throw wsDeleteError
    }

    if (intendedWorkspaceIds.length > 0) {
      const { data: valid } = await supabase
        .from('workspaces')
        .select('id')
        .eq('organization_id', auth.orgId)
        .in('id', intendedWorkspaceIds)

      const { data: held } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('organization_id', auth.orgId)
        .eq('user_id', parsed.data.user_id)

      const existing = new Set((held ?? []).map((row) => row.workspace_id))
      const toAdd = (valid ?? []).filter((workspace) => !existing.has(workspace.id))

      if (toAdd.length > 0) {
        const { error } = await workspaceWriter.from('workspace_members').insert(
          toAdd.map((workspace) => ({
            workspace_id: workspace.id,
            user_id: parsed.data.user_id,
            organization_id: auth.orgId,
            role: 'member' as const,
          })),
        )
        if (error && error.code !== '23505') throw error
      }
    }

    // --- projects ---------------------------------------------------------
    let removeProjects = supabase
      .from('project_members')
      .delete()
      .eq('organization_id', auth.orgId)
      .eq('user_id', parsed.data.user_id)
    if (parsed.data.project_ids.length > 0) {
      removeProjects = removeProjects.not(
        'project_id',
        'in',
        `(${parsed.data.project_ids.join(',')})`,
      )
    }
    const { error: projDeleteError } = await removeProjects
    if (projDeleteError) throw projDeleteError

    const [{ data: organization }, { data: actor }] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', auth.orgId).maybeSingle(),
      supabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle(),
    ])

    // Only the genuinely new grants notify — `grantProjectAccess` decides that,
    // so re-saving an unchanged dialog sends nothing.
    const granted = await grantProjectAccess(supabase, {
      organizationId: auth.orgId,
      orgSlug,
      userId: parsed.data.user_id,
      projectIds: parsed.data.project_ids,
      actorId: auth.userId,
      actorName: actor?.full_name ?? null,
      orgName: organization?.name ?? 'your team',
      appUrl: appUrl(),
    })

    revalidatePath(membersPath(orgSlug))
    return { ok: true, data: { addedProjects: granted.map((project) => project.name) } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Send the invitation again.
 *
 * Only for someone who has never signed in. Re-issuing a link for an active
 * account would be a password-reset by another name, without the checks that
 * flow has.
 */
export async function resendInvite(
  orgSlug: string,
  userId: string,
): Promise<ActionResult<{ emailed: boolean; emailError?: string; acceptUrl?: string }>> {
  const auth = await requireAuth(orgSlug)

  if (!hasPermission(auth.orgRole, 'users', 'create')) {
    return { ok: false, code: 'FORBIDDEN', message: 'You cannot send invitations.' }
  }

  const urlProblem = appUrlProblem()
  if (urlProblem) {
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: `This deployment is misconfigured: ${urlProblem} Ask an administrator to set it before resending.`,
    }
  }

  const supabase = createClient()
  const admin = createAdminClient()
  const origin = appUrl()

  try {
    const { data: directory } = await supabase.rpc('org_member_directory')
    const entry = (directory ?? []).find((row) => row.user_id === userId)

    if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'That member was not found.' }
    if (entry.status !== 'pending') {
      return {
        ok: false,
        code: 'CONFLICT',
        message: 'They have already signed in — send them a password reset instead.',
      }
    }

    // The account already exists — they were invited and never finished — so
    // this asks for a magic link first and only falls back to `invite`.
    const link = await mintAcceptLink(admin, entry.email, orgSlug, origin, true)

    if (!link.ok || !link.acceptUrl) {
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: link.ok ? 'Could not create a new invitation link.' : link.message,
      }
    }

    const acceptUrl = link.acceptUrl

    const [{ data: organization }, { data: inviter }, { data: projects }] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', auth.orgId).maybeSingle(),
      supabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle(),
      supabase
        .from('project_members')
        .select('project:projects!project_members_project_id_fkey(name)')
        .eq('organization_id', auth.orgId)
        .eq('user_id', userId),
    ])

    const projectNames = (projects ?? [])
      .map((row) => (Array.isArray(row.project) ? row.project[0] : row.project))
      .map((project) => project?.name)
      .filter((name): name is string => Boolean(name))

    const delivery = await sendEmail({
      to: entry.email,
      ...inviteEmail({
        orgName: organization?.name ?? 'your team',
        inviterName: inviter?.full_name ?? null,
        role: 'member',
        acceptUrl,
        projectNames,
      }),
    })

    return {
      ok: true,
      data: {
        emailed: delivery.ok,
        emailError: delivery.ok ? undefined : describeDelivery(delivery),
        acceptUrl: delivery.ok ? undefined : acceptUrl,
      },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Mint a link that lands on `/accept-invite`.
 *
 * Two link types, one destination. `invite` is the right one for an address
 * with no account, and the only one that creates the auth user as a side
 * effect. It is refused for an address that already has an account, which is
 * exactly the case of someone invited to another organization who never
 * finished — so those get a `magiclink` instead. Both land on the same screen,
 * where the password is actually set.
 *
 * The type is chosen from what we already know rather than by catching the
 * error, but the fallback is kept: "already registered" is reported with
 * different codes across Supabase versions, and a resend that silently does
 * nothing is worse than one extra round trip.
 */
async function mintAcceptLink(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  orgSlug: string,
  appUrl: string,
  accountExists: boolean,
): Promise<
  { ok: true; userId: string | null; acceptUrl: string | null } | { ok: false; message: string }
> {
  const next = `/accept-invite?org=${orgSlug}`

  const attempts: ('invite' | 'magiclink')[] = accountExists
    ? ['magiclink', 'invite']
    : ['invite', 'magiclink']

  let lastMessage = 'Could not create the invitation.'

  for (const type of attempts) {
    const { data, error } = await admin.auth.admin.generateLink({ type, email })

    /*
     * `hashed_token`, NOT `action_link`.
     *
     * `action_link` points at Supabase's own /auth/v1/verify endpoint, which
     * consumes the token and then redirects with the session in the URL
     * FRAGMENT. A fragment never reaches the server, so a server route sees an
     * empty query string and can only report failure — while the token has
     * already been spent. The observable result was an invited user who was
     * marked confirmed, had no password, and was told "that sign-in could not
     * be completed".
     *
     * `hashed_token` is the same token in the form `verifyOtp` accepts
     * server-side, so /auth/confirm can establish the session in cookies.
     * `redirectTo` is therefore not passed at all: nothing routes through
     * Supabase's verify endpoint any more, and `next` is carried on our own URL.
     */
    if (!error && data?.properties?.hashed_token) {
      const params = new URLSearchParams({
        token_hash: data.properties.hashed_token,
        type,
        next,
      })

      return {
        ok: true,
        userId: data.user?.id ?? null,
        acceptUrl: `${appUrl}/auth/confirm?${params.toString()}`,
      }
    }

    lastMessage = error?.message ?? lastMessage
  }

  return { ok: false, message: lastMessage }
}
