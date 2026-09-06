import 'server-only'

import type { AuthContext } from '@pm/auth'
import { parseCustomPermissions } from '@pm/auth/rbac'
import { resolveEntitlements, type Entitlements } from '@pm/shared/billing'
import type { OrgRole } from '@pm/shared/constants'
import { appError } from '@pm/shared/errors'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { getSigningKeys } from '@/lib/auth/jwks'
import { createClient } from '@/lib/supabase/server'

/**
 * Tenant context for the current request, including the organization metadata
 * that pages would otherwise re-query.
 */
export interface RequestContext extends AuthContext {
  orgSlug: string
  orgTimezone: string
  orgCurrency: string
  orgStatus: string
  /** ISO 3166-1 alpha-2. Decides the payment gateway and the tax regime. */
  billingCountry: string | null
  /**
   * What this organization may actually do, resolved in the database by
   * `org_entitlements()`. Read this rather than the plan name: a custom plan
   * has a name no hardcoded table knows, and entitlement no longer derives
   * from `organizations.plan_id` at all (migration 00037).
   */
  entitlements: Entitlements
  /** Convenience alias for `entitlements.planName`. */
  planName: string | null
}

/**
 * Resolve the authenticated principal for the current request.
 *
 * IDENTITY (§13.5). The rule this satisfies is "never trust the cookie", not
 * "always call the auth server". The project signs tokens with an asymmetric key
 * (ES256), so `getClaims()` verifies the signature locally against the cached
 * JWKS: a forged or tampered cookie fails the same way it would at the auth
 * server, without the round trip. `getSession()` remains forbidden — it decodes
 * without verifying anything.
 *
 * What is given up is instant revocation: a session killed mid-token stays
 * valid here until the token expires. That is covered a layer up — middleware
 * calls `getUser()` on every request, so a revoked session never reaches a
 * render. Doing it again here was checking the same fact twice on the same
 * request, at ~65-240ms a time depending on distance to the auth server.
 *
 * If `getClaims()` cannot verify locally — a symmetric signing key, or no
 * WebCrypto — auth-js falls back to `getUser()` on its own, so this stays
 * correct on a project that has not migrated its keys. It just stops being free.
 *
 * The tenant context is one `current_auth_context` RPC. The org role is read
 * live there rather than from the JWT's `org_role` claim, so a revoked role
 * takes effect immediately instead of at the next token refresh.
 *
 * Wrapped in React's `cache` so every component in one render shares the result.
 */
export const getAuthContext = cache(async (orgSlug?: string): Promise<RequestContext | null> => {
  const supabase = createClient()

  const keys = await getSigningKeys()
  const { data: claimsData } = await supabase.auth.getClaims(
    undefined,
    keys ? { jwks: { keys: keys as never } } : undefined,
  )
  const claims = claimsData?.claims
  if (!claims?.sub) return null

  const { data } = await supabase
    .rpc('current_auth_context', { p_org_slug: orgSlug ?? undefined })
    .maybeSingle()

  const context = data as {
    organization_id: string
    org_role: string
    org_slug: string
    org_timezone: string
    org_currency: string
    org_status: string
    billing_country: string | null
    plan_name: string | null
    plan_tier: string | null
    plan_display_name: string | null
    plan_limits: unknown
    plan_features: unknown
    entitlement_source: string | null
    subscription_status: string | null
    permissions: unknown
  } | null

  if (!context) return null

  const entitlements = resolveEntitlements(context)

  return {
    userId: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    orgId: context.organization_id,
    orgRole: context.org_role as OrgRole,
    orgSlug: context.org_slug,
    orgTimezone: context.org_timezone,
    orgCurrency: context.org_currency,
    orgStatus: context.org_status,
    billingCountry: context.billing_country,
    entitlements,
    planName: entitlements.planName,
    customPermissions: parseCustomPermissions(context.permissions),
    // From the token's assurance level rather than the enrolled-factor list,
    // which is not a claim. This is the stricter of the two readings: aal2 means
    // a second factor was actually satisfied for THIS session, where the old
    // check only meant the account had one enrolled somewhere.
    mfaVerified: claims.aal === 'aal2',
  }
})

/** Same as getAuthContext but throws instead of returning null. For actions. */
export async function requireAuth(orgSlug?: string): Promise<RequestContext> {
  const context = await getAuthContext(orgSlug)
  if (!context) throw appError('UNAUTHORIZED', 'Not signed in')
  return context
}

/** Same as requireAuth but redirects instead of throwing. For pages. */
export async function requireAuthPage(orgSlug?: string): Promise<RequestContext> {
  const context = await getAuthContext(orgSlug)
  if (!context) redirect('/login')
  return context
}
