/**
 * Admin portal config.
 *
 * The CSP here is tighter than the customer app's: no Stripe frames, no
 * third-party embeds, and the whole app is noindex. It is an internal tool that
 * can read every tenant, so its blast radius deserves the stricter policy.
 */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '0' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

/**
 * Served under a path, not its own subdomain.
 *
 * `admin.vektracorp.in` is meant to host the admin console for every Vektra
 * product, so this one lives at `/project` and the next at `/crm`, and so on.
 *
 * A Vercel domain belongs to exactly one project, so today this app owns the
 * subdomain outright. When a second product needs an admin console, a thin
 * shell project takes the domain and rewrites `/project/*` here — and no code
 * in this app has to change, because the basePath is already what it will be.
 *
 * `basePath` is applied automatically to `<Link>`, `redirect()` and asset URLs.
 * It is NOT applied to a URL built by hand — see the note in `middleware.ts`.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH ?? '/project'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Empty in development so the app still answers on localhost:3001/ directly.
  basePath: BASE_PATH === '' ? undefined : BASE_PATH,
  transpilePackages: ['@pm/ui', '@pm/shared', '@pm/auth', '@pm/db'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  async redirects() {
    // The bare subdomain is not a page. Until a shell owns it, send anyone who
    // lands there to this console rather than showing them a 404.
    return BASE_PATH
      ? [{ source: '/', destination: BASE_PATH, basePath: false, permanent: false }]
      : []
  },
}

export default nextConfig
