'use server'

import { revalidatePath } from 'next/cache'
import { recordAdminAction } from '@/lib/audit'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SETTABLE_STATUS } from './status'

/**
 * Console mutations.
 *
 * Every one re-checks `canWrite` even though the UI hides the controls for a
 * read-only operator, and every one writes an audit row — a service-role change
 * with no trace is exactly what §13.11 exists to prevent.
 *
 * Auditing lives in `lib/audit.ts` now. The previous local helper wrote only to
 * `audit_logs`, and because that table's organization_id is NOT NULL it
 * silently dropped every platform-wide action: publishing a notice and toggling
 * a feature flag left no record anywhere. `platform_audit_logs` (00037) exists
 * for precisely those, and is now written for all of them.
 */

export interface ConsoleResult {
  ok: boolean
  message?: string
}

const NOTICE_TYPES = ['info', 'warning', 'critical', 'maintenance'] as const

export async function createNotice(formData: FormData): Promise<ConsoleResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const title = String(formData.get('title') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  const type = String(formData.get('type') ?? 'info')
  const endsAt = String(formData.get('ends_at') ?? '').trim()

  if (!title || !body) return { ok: false, message: 'Title and body are required.' }
  if (!(NOTICE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, message: 'Unknown notice type.' }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('system_notices')
    .insert({
      title,
      body,
      type,
      // Targeting beyond "everyone" arrives with the marketing module; a notice
      // created here is deliberately platform-wide rather than silently scoped.
      target: { scope: 'all' },
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      created_by: admin.email,
    })
    .select('id')
    .single()

  if (error) return { ok: false, message: error.message }

  await recordAdminAction(admin, {
    action: 'notice.created',
    resourceType: 'system_notice',
    resourceId: data.id,
    changes: { title, type },
  })

  revalidatePath('/notices')
  return { ok: true }
}

export async function setNoticeActive(id: string, isActive: boolean): Promise<ConsoleResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('system_notices')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) return { ok: false, message: error.message }

  await recordAdminAction(admin, {
    action: isActive ? 'notice.activated' : 'notice.deactivated',
    resourceType: 'system_notice',
    resourceId: id,
  })

  revalidatePath('/notices')
  return { ok: true }
}

export async function setFlagEnabled(id: string, isEnabled: boolean): Promise<ConsoleResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('feature_flags')
    .update({ is_enabled: isEnabled, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('key')
    .single()

  if (error) return { ok: false, message: error.message }

  await recordAdminAction(admin, {
    action: isEnabled ? 'feature_flag.enabled' : 'feature_flag.disabled',
    resourceType: 'feature_flag',
    resourceId: id,
    changes: { key: data.key, is_enabled: isEnabled },
  })

  revalidatePath('/feature-flags')
  return { ok: true }
}

/**
 * Set a tenant's status — the console's most consequential action, since
 * `suspended` and `banned` lock every one of that tenant's users out of the
 * product (org_is_blocked, 00048).
 *
 * A reason is mandatory for the two blocking statuses. It is shown to the
 * tenant on the blocked screen, so it is written for them to read, not as an
 * internal note — an unexplained lockout generates a support ticket that the
 * operator then cannot answer either.
 */
export async function setOrgStatus(formData: FormData): Promise<ConsoleResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const orgId = String(formData.get('org_id') ?? '')
  const status = String(formData.get('status') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()

  if (!orgId) return { ok: false, message: 'Missing organization.' }
  if (!(status in SETTABLE_STATUS)) return { ok: false, message: 'Unknown status.' }

  const blocking = status === 'suspended' || status === 'banned'
  if (blocking && !reason) {
    return { ok: false, message: 'A reason is required — the tenant is shown it on the blocked screen.' }
  }

  const supabase = createAdminClient()

  const { data: before } = await supabase
    .from('organizations')
    .select('status, name')
    .eq('id', orgId)
    .maybeSingle()

  if (!before) return { ok: false, message: 'Organization not found.' }
  if (before.status === status) return { ok: false, message: `Already ${status}.` }

  const { error } = await supabase
    .from('organizations')
    .update({
      status,
      status_reason: reason || null,
      status_changed_at: new Date().toISOString(),
    })
    .eq('id', orgId)

  if (error) return { ok: false, message: error.message }

  await recordAdminAction(admin, {
    action: `organization.${status}`,
    resourceType: 'organization',
    resourceId: orgId,
    organizationId: orgId,
    changes: { status: { old: before.status, new: status }, reason: reason || null },
  })

  revalidatePath('/orgs')
  revalidatePath(`/orgs/${orgId}`)
  revalidatePath('/')
  return { ok: true }
}
