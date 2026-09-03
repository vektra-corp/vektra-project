// Sentry initialization for the edge runtime (middleware, edge routes).
// Loaded via instrumentation.ts (Next 14 instrumentation hook).
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Same privacy posture as the server runtime — see sentry.server.config.ts.
  sendDefaultPii: false,
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },

  beforeSend(event) {
    if (event.request) {
      delete event.request.cookies
      delete event.request.data
      delete event.request.headers
    }
    return event
  },

  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
})
