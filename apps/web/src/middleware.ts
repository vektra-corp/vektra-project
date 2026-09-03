import { extractOrgSlug, isPublicRoute } from '@pm/auth/middleware'
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

  const orgSlug = extractOrgSlug(pathname)
  if (orgSlug) {
    const { data: membership } = await supabase
      .from('org_members')
      .select('organization_id, organizations!inner(slug)')
      .eq('user_id', user.id)
      .eq('organizations.slug', orgSlug)
      .maybeSingle()

    if (!membership) {
      // A portal user may still legitimately reach the portal routes for this org.
      const { data: portalAccess } = await supabase
        .from('portal_users')
        .select('id, organizations!inner(slug)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .eq('organizations.slug', orgSlug)
        .maybeSingle()

      if (!portalAccess) {
        return NextResponse.redirect(new URL('/403', request.url))
      }
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
