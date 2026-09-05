import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Admin portal guard.
 *
 * Only refreshes the session and blocks anonymous access. The real
 * authorization check is `requireAdmin()` in each page, because it needs the
 * service-role client to read admin_users and middleware runs on the edge.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && request.nextUrl.pathname !== '/login') {
    /*
     * `nextUrl.clone()`, not `new URL('/login', request.url)`.
     *
     * The app is served under a basePath. Middleware sees `nextUrl.pathname`
     * with that prefix already stripped, and a URL built by hand from
     * `request.url` does not get it back — the redirect would point at
     * `/login` instead of `/project/login`, which is a 404, and the person
     * bounces between the two forever. Cloning preserves the basePath.
     */
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|woff2?)$).*)'],
}
