'use client'

import type { Database } from '@pm/db/types'
import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'

/**
 * Browser client. Uses the anon key, so every request it makes is subject to
 * RLS — this client can never see another tenant's rows.
 */
export function createClient() {
  return createSupabaseBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

/** Alias kept for readability at call sites in hooks. */
export const createBrowserClient = createClient
