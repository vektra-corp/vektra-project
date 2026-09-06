'use client'

import { Button } from '@pm/ui'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle } from 'lucide-react'
import { useEffect } from 'react'

/**
 * Body of a route-level `error.tsx`.
 *
 * Without a boundary at each section, one failed query escalates to
 * `global-error.tsx`, which unmounts the root layout — the sidebar disappears
 * and the whole app goes blank over a single unreadable table. Catching it here
 * keeps the shell and the navigation alive so the user can go somewhere else.
 *
 * The message deliberately does not include `error.message`: §13.8 forbids
 * leaking internal detail to the client. The digest is Next's own opaque
 * identifier and is safe to show — it is what ties this screen to the Sentry
 * event.
 */
export function SectionError({
  error,
  reset,
  title = 'Could not load this section',
}: {
  error: Error & { digest?: string }
  reset: () => void
  title?: string
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-16">
      <div className="max-w-sm text-center">
        <div className="bg-surface-hover mx-auto flex h-9 w-9 items-center justify-center rounded-full">
          <AlertTriangle className="text-warning h-4 w-4" aria-hidden />
        </div>
        <h2 className="text-foreground pt-3 text-base font-semibold">{title}</h2>
        <p className="text-faint pt-1.5 text-ui">
          Something went wrong fetching this data. The rest of the app is still available.
        </p>
        <div className="flex justify-center pt-4">
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
        </div>
        {error.digest ? (
          <p className="text-subtle pt-3 text-nav">Reference: {error.digest}</p>
        ) : null}
      </div>
    </div>
  )
}
