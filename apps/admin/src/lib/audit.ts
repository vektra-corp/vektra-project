import 'server-only'

import type { AdminContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Operator audit.
 *
 * 00037 states the contract this implements: where an action affects a tenant
 * the console writes BOTH trails — `platform_audit_logs` for the operator
 * record, and `audit_logs` so the customer can see in their own settings that
 * support changed something. Where there is no tenant (a catalogue price, a
 * recorded expense) only the platform trail applies, because
 * `audit_logs.organization_id` is NOT NULL and inventing an org to satisfy it
 * would put operator activity into some tenant's feed.
 *
 * Before this existed the console wrote a tenant row when it had an org id and
 * silently dropped the event otherwise, so publishing a notice or toggling a
 * feature flag left no trace anywhere.
 */
export async function recordAdminAction(
  admin: AdminContext,
  input: {
    action: string
    resourceType: string
    resourceId?: string | null
    organizationId?: string | null
    changes?: Record<string, unknown>
    /** Set false for platform-only actions that should not appear in a tenant's feed. */
    notifyTenant?: boolean
  },
): Promise<void> {
  const supabase = createAdminClient()

  // The operator trail. Append-only at the database level (00037), so a failure
  // here is a real problem and is not swallowed.
  const { error } = await supabase.from('platform_audit_logs').insert({
    admin_user_id: admin.adminUserId,
    admin_email: admin.email,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    organization_id: input.organizationId ?? null,
    changes: (input.changes ?? null) as never,
    metadata: { admin_role: admin.role },
  })
  if (error) throw new Error(`audit write failed: ${error.message}`)

  if (!input.organizationId || input.notifyTenant === false) return

  // The tenant's own trail. actor_id is deliberately NULL: the operator is not a
  // member of this organization, and pointing actor_id at a user row the tenant
  // cannot resolve would render as a broken name in their audit log. actor_type
  // 'admin' plus the email in metadata is the honest representation.
  await supabase.from('audit_logs').insert({
    organization_id: input.organizationId,
    actor_id: null,
    actor_type: 'admin',
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    changes: (input.changes ?? null) as never,
    metadata: { admin_email: admin.email },
  })
}
