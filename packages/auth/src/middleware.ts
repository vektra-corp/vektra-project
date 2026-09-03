import { PUBLIC_ROUTE_PREFIXES } from './constants'

/**
 * Framework-agnostic helpers used by both apps' `middleware.ts`.
 * Nothing here touches Next.js types, so it stays unit-testable.
 */

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function isProtectedRoute(pathname: string): boolean {
  if (isPublicRoute(pathname)) return false
  // Next.js internals and static assets are excluded by the matcher, not here.
  return !pathname.startsWith('/_next') && pathname !== '/favicon.ico'
}

/**
 * Extract the org slug from a dashboard or portal URL.
 * `/acme/engineering/projects` -> `acme`
 * Returns null for non-tenant routes so the caller skips the membership check.
 */
export function extractOrgSlug(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  const first = segments[0]
  if (!first) return null
  if (isPublicRoute(`/${first}`)) return null
  if (first === 'api' || first === 'onboarding' || first === 'select-org') return null
  return /^[a-z0-9][a-z0-9-]*$/.test(first) ? first : null
}

export function extractWorkspaceSlug(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  return segments[1] ?? null
}

/**
 * Origin check for state-changing API routes (§13.4).
 * Webhook routes are exempt — they verify a provider signature instead.
 */
export function isAllowedOrigin(
  origin: string | null,
  allowed: readonly (string | undefined)[],
): boolean {
  if (!origin) return false
  return allowed.filter(Boolean).includes(origin)
}

/**
 * Fingerprint used to spot a session being replayed from a new device (§13.6).
 * Hashed rather than stored raw so the sessions table holds no PII beyond what
 * the user can already see about their own logins.
 */
export async function sessionFingerprint(ip: string, userAgent: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${userAgent}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Best-effort client IP from proxy headers, for rate limiting and audit logs. */
export function clientIp(headers: {
  get(name: string): string | null
}): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]
    if (first) return first.trim()
  }
  return headers.get('x-real-ip') ?? 'unknown'
}
