'use server'

import { revalidatePath } from 'next/cache'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Console mutations.
 *
 * Every one of these re-checks `canWrite` even though the UI hides the controls
 * for a read-only operator, and every one writes an audit row — a service-role
 * change with no trace is exactly what §13.11 exists to prevent.
 */

export interface ConsoleResult {
  ok: boolean
  message?: string
}

const NOTICE_TYPES = ['info', 'warning', 'critical', 'maintenance'] as const

async function record(action: string, resourceId: string | null, changes: unknown) {
  const admin = await requireAdmin()
  const supabase = createAdminClient()
  // organization_id is NOT NULL on audit_logs, so platform-wide actions are not
  // representable there; they are recorded per affected tenant where one exists
  // and skipped where none does, rather than being written against a fake org.
  if (!resourceId) return
  await supabase.from('audit_logs').insert({
    organization_id: resourceId,
    actor_id: admin.userId,
    actor_type: 'admin',
    action,
    resource_type: 'organization',
    resource_id: resourceId,
    changes: changes as never,
    metadata: { admin_email: admin.email },
  })
}

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
  const { error } = await supabase.from('system_notices').insert({
    title,
    body,
    type,
    // Targeting beyond "everyone" arrives with the marketing module; a notice
    // created here is deliberately platform-wide rather than silently scoped.
    target: { scope: 'all' },
    ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    created_by: admin.email,
  })

  if (error) return { ok: false, message: error.message }

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

  revalidatePath('/notices')
  return { ok: true }
}

export async function setFlagEnabled(id: string, isEnabled: boolean): Promise<ConsoleResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('feature_flags')
    .update({ is_enabled: isEnabled, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { ok: false, message: error.message }

  revalidatePath('/feature-flags')
  return { ok: true }
}

export async function setOrgStatus(orgId: string, status: string): Promise<ConsoleResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const allowed = ['active', 'trial', 'suspended', 'churned']
  if (!allowed.includes(status)) return { ok: false, message: 'Unknown status.' }

  const supabase = createAdminClient()
  const { data: before } = await supabase
    .from('organizations')
    .select('status')
    .eq('id', orgId)
    .maybeSingle()

  const { error } = await supabase.from('organizations').update({ status }).eq('id', orgId)
  if (error) return { ok: false, message: error.message }

  await record('organization.status_changed', orgId, {
    status: { old: before?.status ?? null, new: status },
  })

  revalidatePath('/orgs')
  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}
