'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

/**
 * TanStack Query is the only home for server state (claude.md §10).
 *
 * Cache settings follow §23.2 rule 7: 30s stale time for most data, 10 minutes
 * before garbage collection. Slow-changing data (plan limits, org settings)
 * overrides staleTime at the individual query.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  // Created in state so each browser session gets one client, and so it is not
  // shared between requests during SSR.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Never retry an authorization failure — it will not succeed.
              const status = (error as { status?: number })?.status
              if (status === 401 || status === 403 || status === 404) return false
              return failureCount < 2
            },
          },
        },
      }),
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
