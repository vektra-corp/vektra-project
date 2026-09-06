'use server'

import { canManageRole } from '@pm/auth/rbac'
import type { OrgRole } from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { fieldErrors, inviteMemberSchema, memberRoleUpdateSchema } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
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
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const admin = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  try {
    // Reuse an existing account when the person already has one, so inviting a
    // colleague who is in another org adds a membership rather than failing.
    const { data: existing } = await admin.rpc('user_id_for_email', {
      p_email: parsed.data.email,
    })

    let userId = existing as string | null
    let acceptUrl: string | null = null

    if (!userId) {
      // A brand new account. The link lands on /accept-invite, which is where
      // they set a password — without that step the account has none and they
      // could never sign in again after this one link expires.
      const redirectTo = `${appUrl}/auth/callback?next=${encodeURIComponent(
        `/accept-invite?org=${orgSlug}`,
      )}`

      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'invite',
        email: parsed.data.email,
        options: { redirectTo },
      })

      if (linkError || !link?.user) {
        return {
          ok: false,
          code: 'INTERNAL_ERROR',
          message: linkError?.message ?? 'Could not create the invitation.',
        }
      }

      userId = link.user.id
      acceptUrl = link.properties?.action_link ?? null
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

    if (parsed.data.workspace_ids.length > 0) {
      // Scoped to this org explicitly: the service-role client bypasses RLS, so
      // an id from the form must not be trusted to belong here.
      const { data: workspaces } = await admin
        .from('workspaces')
        .select('id')
        .eq('organization_id', auth.orgId)
        .in('id', parsed.data.workspace_ids)

      if (workspaces?.length) {
        await admin.from('workspace_members').insert(
          workspaces.map((workspace) => ({
            workspace_id: workspace.id,
            user_id: userId!,
            organization_id: auth.orgId,
            role: 'member' as const,
          })),
        )
      }
    }

    // Everything that grants access has succeeded by here. The mail is sent
    // last and its failure is not propagated: a member who exists but was not
    // emailed can be told in person, while an error now would leave the caller
    // believing the invitation did not happen at all.
    const [{ data: organization }, { data: inviter }] = await Promise.all([
      admin.from('organizations').select('name').eq('id', auth.orgId).maybeSingle(),
      admin.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle(),
    ])

    const message = acceptUrl
      ? inviteEmail({
          orgName: organization?.name ?? 'your team',
          inviterName: inviter?.full_name ?? null,
          role: parsed.data.role,
          acceptUrl,
        })
      : addedToOrgEmail({
          orgName: organization?.name ?? 'your team',
          inviterName: inviter?.full_name ?? null,
          role: parsed.data.role,
          orgUrl: `${appUrl}/${orgSlug}/dashboard`,
        })

    const delivery = await sendEmail({ to: parsed.data.email, ...message })

    revalidatePath(membersPath(orgSlug))
    return { ok: true, data: { email: parsed.data.email, emailed: delivery.ok } }
  } catch (error) {
    return toActionError(error)
  }
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
