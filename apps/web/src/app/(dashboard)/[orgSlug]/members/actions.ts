'use server'

import { canManageRole } from '@pm/auth/rbac'
import type { OrgRole } from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { fieldErrors, inviteMemberSchema, memberRoleUpdateSchema } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
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

/**
 * Invite someone to the organization.
 *
 * Uses the service-role client for exactly two things — looking up whether the
 * email already has an account, and issuing the invite — because both are
 * `auth.users` operations that RLS cannot express. Every tenant write below it
 * is still scoped to the caller's own `orgId`, explicitly (§13.10).
 */
export async function inviteMember(
  orgSlug: string,
  _prevState: ActionResult<{ email: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ email: string }>> {
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

  try {
    // Reuse an existing account when the person already has one, so inviting a
    // colleague who is in another org adds a membership rather than failing.
    const { data: existing } = await admin.rpc('user_id_for_email', {
      p_email: parsed.data.email,
    })

    let userId = existing as string | null

    if (!userId) {
      const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback?next=/${orgSlug}/dashboard`
      const { data: invited, error: inviteError } =
        await admin.auth.admin.inviteUserByEmail(parsed.data.email, { redirectTo })

      if (inviteError) {
        return { ok: false, code: 'INTERNAL_ERROR', message: inviteError.message }
      }
      userId = invited.user.id
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

    revalidatePath(membersPath(orgSlug))
    return { ok: true, data: { email: parsed.data.email } }
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
