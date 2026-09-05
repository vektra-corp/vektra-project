import { withSentryConfig } from '@sentry/nextjs/config'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const isDev = process.env.NODE_ENV === 'development'

/**
 * Security headers (claude.md §13.2).
 *
 * The CSP is deliberately strict: object-src and frame-ancestors are 'none',
 * base-uri and form-action are pinned to self. 'unsafe-inline' remains on
 * script-src only because Next's App Router inlines its hydration bootstrap;
 * tightening that to a nonce is tracked for the hardening phase.
 *
 * `'unsafe-eval'` is added in DEVELOPMENT ONLY. Next's dev build compiles
 * modules with `eval` for hot reloading and source maps, so a policy without it
 * makes the browser refuse the client bundle — React never hydrates, and every
 * interactive element in the app silently does nothing. Nothing reports this:
 * the page renders fine, the server logs are clean, and only the browser
 * console shows the violation. It was found by an end-to-end test clicking a
 * button that never responded.
 *
 * It is NOT added to production builds, which contain no `eval`. If this ever
 * needs to be relaxed in production, that is a different decision requiring a
 * different justification.
 */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://js.stripe.com https://challenges.cloudflare.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self'",
      // ws: in development is the hot-reload socket; without it the dev server
      // reconnects in a loop and the browser console fills with failures.
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io${isDev ? ' ws: http://localhost:* http://127.0.0.1:*' : ''}`,
      "frame-src https://js.stripe.com https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Disabled deliberately: the legacy auditor introduces its own issues and CSP
  // supersedes it.
  { key: 'X-XSS-Protection', value: '0' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(self)',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source, compiled by Next rather than
  // pre-built, so a change in a package is picked up without a build step.
  transpilePackages: ['@pm/ui', '@pm/shared', '@pm/auth', '@pm/db'],
  experimental: {
    typedRoutes: false,
    // Next 14 only loads instrumentation.ts when this is on. Without it the
    // Sentry server and edge configs never run.
    instrumentationHook: true,
    // isomorphic-dompurify pulls in jsdom, which reads files off disk at
    // runtime (jsdom/lib/jsdom/browser/default-stylesheet.css). Bundling it
    // breaks that read with ENOENT.
    //
    // jsdom must be listed too, not just the wrapper: it is the package doing
    // the reading, and externalising only the wrapper still lets webpack pull
    // jsdom into the bundle behind it.
    serverComponentsExternalPackages: ['isomorphic-dompurify', 'jsdom'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'http', hostname: '127.0.0.1' },
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default withSentryConfig(withNextIntl(nextConfig), {
 // For all available options, see:
 // https://www.npmjs.com/package/@sentry/webpack-plugin#options

 org: "ecappz-technology-private-limi",

 project: "vektra-project",

 // Only print logs for uploading source maps in CI
 silent: !process.env.CI,

 // For all available options, see:
 // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

 // Upload a larger set of source maps for prettier stack traces (increases build time)
 widenClientFileUpload: true,

 // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
 // This can increase your server load as well as your hosting bill.
 // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
 // side errors will fail.
 // tunnelRoute: "/monitoring",

 webpack: {
   // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
   // See the following for more information:
   // https://docs.sentry.io/product/crons/
   // https://vercel.com/docs/cron-jobs
   automaticVercelMonitors: true,

   // Tree-shaking options for reducing bundle size
   treeshake: {
     // Automatically tree-shake Sentry logger statements to reduce bundle size
     removeDebugLogging: true,
   },
 },
});
