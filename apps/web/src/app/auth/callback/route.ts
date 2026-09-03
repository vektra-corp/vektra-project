import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * OAuth / email-confirmation callback (PKCE flow, §13.5).
 *
 * Exchanges the one-time code for a session and forwards the user on. The
 * `next` parameter is validated as a same-origin path before use — accepting it
 * verbatim would make this an open redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next')

  // Only a relative path, and never a protocol-relative one like "//evil.com".
  const next = rawNext && /^\/(?!\/)/.test(rawNext) ? rawNext : '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=invalid_code`)
  }

  // Behind a proxy the forwarded host is the user-facing one; origin is the
  // internal address and would send the user somewhere unreachable.
  const forwardedHost = request.headers.get('x-forwarded-host')
  const isLocal = process.env.NODE_ENV === 'development'
  const base = !isLocal && forwardedHost ? `https://${forwardedHost}` : origin

  return NextResponse.redirect(`${base}${next}`)
}
