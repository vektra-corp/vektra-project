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

/**
 * Client-side navigation instrumentation.
 *
 * Without this export the SDK prints an ACTION REQUIRED warning on every dev
 * start, and — more to the point — a route change is not recorded as a
 * transaction. Traces then cover the first page load and nothing after it,
 * which for an app people navigate around inside is most of the session.
 *
 * The eslint-disable is not a workaround for a mistake. `@sentry/nextjs` has
 * conditional exports, and this symbol exists only in the CLIENT build.
 * `import/namespace` resolves the package's server entry and concludes it is
 * missing; TypeScript resolves the right condition and accepts it. This file is
 * client-only, so the rule is looking at the wrong build, not at a real error.
 */
// eslint-disable-next-line import/namespace -- see below
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
