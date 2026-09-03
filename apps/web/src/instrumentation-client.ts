/**
 * Sentry initialization for the browser.
 *
 * Session replay is deliberately NOT enabled. This app renders one tenant's
 * data, and a replay — even with text masked — puts that recording in front of
 * whoever triages the issue. Enable it only with an explicit customer agreement.
 *
 * The DSN comes from the environment rather than being hardcoded, so staging
 * and production report to their own projects.
 */
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  sendDefaultPii: false,
  // Locally there is no Sentry project to talk to.
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
})
