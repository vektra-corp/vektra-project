import {
  extractOrgSlug,
  isMfaExemptRoute,
  isPublicRoute,
  needsSecondFactor,
} from '@pm/auth/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/middleware'

/**
 * Request guard (claude.md §13.5).
 *
 * Runs on every request that is not a static asset or a webhook:
 *   1. Refresh the session so the access token stays valid.
 *   2. Redirect unauthenticated users to /login, remembering where they were.
 *   3. Resolve the org from the URL slug and verify membership.
 *
 * Step 3 is the one that matters: without it, editing the slug in the address
 * bar would render another tenant's shell before RLS silently emptied it. The
 * check turns that into a clean 403.
 */
export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request)
  const pathname = request.nextUrl.pathname

  // getUser() revalidates against the auth server. getSession() only reads the
  // cookie and is trivially forgeable, so it must not be used for a guard.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    if (isPublicRoute(pathname)) return response()
    const loginUrl = new URL('/login', request.url)
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Signed-in users have no business on the auth screens.
  if (pathname === '/login' || pathname === '/signup') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  /*
   * Second factor (§13.5).
   *
   * A password sign-in establishes a session at aal1 straight away, so without
   * this the code prompt would be a suggestion: type the URL of any page and
   * you are in. Enforcing it here is what makes it binding.
   *
   * The aal claim is read from the access token rather than asked for
   * separately — getUser() has already validated that token against the auth
   * server, so the claim inside it is trustworthy and free.
   */
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  let aal: string | null = null
  if (accessToken) {
    try {
      const claims = JSON.parse(
        Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString(),
      ) as { aal?: string }
      aal = claims.aal ?? null
    } catch {
      // An unreadable token means no evidence of aal2. Fail closed.
      aal = null
    }
  }

  if (needsSecondFactor(aal, user.factors) && !isMfaExemptRoute(pathname)) {
    const challenge = new URL('/mfa', request.url)
    if (pathname !== '/') challenge.searchParams.set('next', pathname)
    return NextResponse.redirect(challenge)
  }

  // Nothing to prove, so the challenge page is not somewhere to linger.
  if (pathname === '/mfa' && !needsSecondFactor(aal, user.factors)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const orgSlug = extractOrgSlug(pathname)
  if (orgSlug) {
    const { data: membership } = await supabase
      .from('org_members')
      .select('organization_id, organizations!inner(slug, status)')
      .eq('user_id', user.id)
      .eq('organizations.slug', orgSlug)
      .maybeSingle()

    if (!membership) {
      return NextResponse.redirect(new URL('/403', request.url))
    }

    /*
     * A suspended or banned tenant is locked out here, at the same gate that
     * proves membership (org_is_blocked, 00048).
     *
     * This is enforcement, not decoration: before it existed the admin console
     * could set the status and nothing in the product changed — every user of a
     * "suspended" organization carried on working. The check is deliberately in
     * middleware rather than in a layout, so it covers server actions and API
     * routes under the org path too, not just rendered pages.
     */
    const organization = Array.isArray(membership.organizations)
      ? membership.organizations[0]
      : membership.organizations

    if (organization && (organization.status === 'suspended' || organization.status === 'banned')) {
      /*
       * Deliberately a top-level route, not `/{orgSlug}/blocked`. Anything under
       * the org segment inherits the dashboard layout, which renders the full
       * sidebar and loads the tenant's workspaces — showing someone the product
       * chrome while telling them they have no access, and doing tenant work to
       * say so. `/blocked` is in NON_TENANT_SEGMENTS, so this redirect target
       * never re-enters the branch that produced it.
       */
      const blockedUrl = new URL('/blocked', request.url)
      blockedUrl.searchParams.set('org', orgSlug)
      return NextResponse.redirect(blockedUrl)
    }
  }

  return response()
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   - Next.js internals and static assets
     *   - /api/webhooks (signature-verified, must not be redirected)
     *   - /api/inngest  (signature-verified)
     *   - image and font files
     */
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/inngest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
}
