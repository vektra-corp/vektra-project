/**
 * Next.js instrumentation hook.
 *
 * Loads the Sentry server and edge configs. Without this file neither runs, and
 * server-side error reporting silently does nothing.
 */
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
