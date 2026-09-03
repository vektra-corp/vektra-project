import type { Database } from '@pm/db/types'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Anon-key client, used only to establish who the admin operator is. */
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
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Components cannot set cookies; middleware refreshes instead.
          }
        },
      },
    },
  )
}
