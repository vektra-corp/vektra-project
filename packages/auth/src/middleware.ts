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

/** The external portal is mounted under a literal prefix, not at the root. */
const PORTAL_PREFIX = 'portal'

/*
 * Top-level paths that are NOT an organisation slug.
 *
 * Every route at the root of the app has to be listed, because anything not
 * listed is read as a tenant slug — and a signed-in user visiting one is then
 * checked for membership of an organisation that does not exist, and sent to
 * /403. That has bitten twice now: once for `/portal`, and once for `/mfa`,
 * where it made the second-factor page unreachable and left the person in a
 * redirect loop they could not escape.
 *
 * Derived from PUBLIC_ROUTE_PREFIXES where possible so adding a public route
 * cannot forget this list, plus the authenticated non-tenant routes.
 */
const NON_TENANT_SEGMENTS = [
  ...PUBLIC_ROUTE_PREFIXES.map((prefix) => prefix.replace(/^\//, '').split('/')[0]),
  'api',
  'auth',
  'onboarding',
  'select-org',
  'mfa',
  'logout',
]

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/**
 * Extract the org slug from a dashboard or portal URL.
 * `/acme/engineering/projects` -> `acme`
 * `/portal/acme/projects`      -> `acme`
 * Returns null for non-tenant routes so the caller skips the membership check.
 */
export function extractOrgSlug(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)

  // Portal URLs carry the org one segment deeper. Without this the guard would
  // check membership of an organization literally named "portal", find none,
  // and 403 every external user.
  const offset = segments[0] === PORTAL_PREFIX ? 1 : 0
  const candidate = segments[offset]

  if (!candidate) return null
  if (offset === 0) {
    if (isPublicRoute(`/${candidate}`)) return null
    if (NON_TENANT_SEGMENTS.includes(candidate)) return null
  }

  return SLUG_PATTERN.test(candidate) ? candidate : null
}

/** True when the path addresses the external portal rather than the app. */
export function isPortalRoute(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean)
  return segments[0] === PORTAL_PREFIX
}

export function extractWorkspaceSlug(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  // The portal has no workspace level — projects are addressed directly.
  if (segments[0] === PORTAL_PREFIX) return null
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

/**
 * Whether this request must complete a second factor before proceeding (§13.5).
 *
 * MFA is only meaningful if it cannot be walked around. Signing in with a
 * password establishes a session at `aal1` immediately — so without a guard
 * here, someone could be shown the code prompt, navigate to any other URL, and
 * be signed in anyway. This is what makes the prompt binding rather than
 * decorative.
 *
 * The rule: a user who has a VERIFIED factor and holds an `aal1` token is sent
 * to the challenge. An unverified factor (enrolment started, never completed)
 * does not count — otherwise abandoning enrolment would lock someone out of
 * their own account.
 *
 * @param aal      The `aal` claim from the access token.
 * @param factors  The user's enrolled factors.
 */
export function needsSecondFactor(
  aal: string | null | undefined,
  factors: readonly { status?: string }[] | null | undefined,
): boolean {
  if (aal === 'aal2') return false
  const verified = (factors ?? []).some((factor) => factor.status === 'verified')
  return verified
}

/** Routes reachable while a second factor is outstanding. */
const MFA_ALLOWED_PREFIXES = ['/mfa', '/logout', '/403']

/**
 * Whether a path may be visited before the second factor is satisfied.
 *
 * Deliberately a short allow-list rather than a block-list: anything not named
 * here is off-limits until the challenge is answered, so a route added later is
 * protected by default.
 */
export function isMfaExemptRoute(pathname: string): boolean {
  if (isPublicRoute(pathname)) return true
  return MFA_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}


/**
 * A `next=` parameter that is safe to redirect to (§13.4).
 *
 * `next.startsWith('/')` is the obvious check and it is not enough: `//evil.com`
 * starts with a slash and is a PROTOCOL-RELATIVE URL, which browsers resolve to
 * `https://evil.com`. So does `/\evil.com` where the backslash is normalised.
 * That turns any page taking a `next` into an open redirect —
 * `/login?next=//evil.com` is a link an attacker can send, and the victim
 * arrives at the attacker's site having just typed their password on ours,
 * which is the shape of every credential-phishing flow.
 *
 * Rather than enumerate the tricks, this resolves the value against an origin
 * that cannot exist and requires the result to still be on it. Anything that
 * escapes — a scheme, an authority, a protocol-relative prefix — changes the
 * origin and is refused.
 *
 * Returns the fallback for anything it will not vouch for.
 */
export function safeNextPath(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string' || next.length === 0) return fallback

  // Raw control characters and whitespace are stripped by browsers before
  // parsing, so "/<tab>https://evil.com" can become an absolute URL. Nothing
  // legitimate contains them — an encoded space is %20.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007F]/.test(next)) return fallback

  if (!next.startsWith('/')) return fallback
  // Cheap, explicit rejections before the parse, so the intent is readable.
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback

  const base = 'https://redirect-guard.invalid'
  try {
    const resolved = new URL(next, base)
    if (resolved.origin !== base) return fallback
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return fallback
  }
}
