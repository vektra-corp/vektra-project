import type { Database } from '@pm/db/types'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-component and server-action client (claude.md §8).
 *
 * Still the anon key: RLS remains the boundary even on the server. The only
 * client that bypasses RLS is the service-role one in ./admin.ts.
 */
export function createClient() {
  const cookieStore = cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Server Components cannot set cookies. The middleware refreshes the
            // session on every request, so ignoring this is safe.
          }
        },
      },
    },
  )
}
