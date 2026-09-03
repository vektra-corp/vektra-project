/**
 * Next.js instrumentation hook.
 *
 * The wizard created sentry.server.config.ts and sentry.edge.config.ts but not
 * this file, so neither was ever loaded — server-side error reporting was
 * silently doing nothing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs'
