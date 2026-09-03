// Sentry initialization for the Node.js server runtime.
// Loaded via instrumentation.ts (Next 14 instrumentation hook).
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  // Sampling: everything in development, a slice in production so a busy tenant
  // cannot dominate the quota.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // This is a multi-tenant app handling customer data. Nothing that could carry
  // another organization's content is allowed off the box (claude.md §13.10):
  // no request bodies, no cookies, no headers.
  sendDefaultPii: false,
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },

  // Last line of defence: strip anything that slipped through.
  beforeSend(event) {
    if (event.request) {
      delete event.request.cookies
      delete event.request.data
      delete event.request.headers
    }
    return event
  },

  // Locally there is no Sentry project to talk to.
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
})
