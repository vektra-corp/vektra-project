/**
 * Sentry initialization for the browser.
 *
 * The wizard never created a client config, so browser errors were not being
 * reported at all.
 *
 * Session replay is deliberately not enabled: this app shows one tenant's data,
 * and a replay — even with text masked — puts that recording in front of whoever
 * triages the issue. Revisit only with an explicit customer agreement.
 */
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  sendDefaultPii: false,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
})
