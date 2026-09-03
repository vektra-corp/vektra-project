import 'server-only'

import type { Database } from '@pm/db/types'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client for the admin portal. BYPASSES RLS by design — this is
 * the tool that has to see across every tenant.
 *
 * Because RLS is not filtering here, two rules apply to every caller:
 *   1. `requireAdmin()` must have run first. There is no other gate.
 *   2. Anything that touches one tenant's data gets an audit_logs row.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
