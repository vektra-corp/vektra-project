import 'server-only'

import type { Database } from '@pm/db/types'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client. BYPASSES RLS.
 *
 * The `server-only` import above makes importing this from a client component a
 * build error rather than a runtime leak of the key.
 *
 * Permitted callers (claude.md §13.10) and nothing else:
 *   1. The Stripe webhook handler
 *   2. The admin portal backend
 *   3. Inngest background jobs
 *   4. Edge Functions needing cross-org access
 *
 * Every use must scope its own queries by organization_id explicitly — the
 * database will not do it for you here.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
