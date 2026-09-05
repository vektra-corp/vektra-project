import { clientIp, safeNextPath } from '@pm/auth/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { recordSession } from '@/lib/auth/sessions'
import { createClient } from '@/lib/supabase/server'

/**
 * OAuth / invite callback (PKCE flow, §13.5).
 *
 * Exchanges the one-time code for a session and forwards the user on. The
 * `next` parameter is validated as a same-origin path before use — accepting it
 * verbatim would make this an open redirect.
 *
 * Everything that can go wrong here lands back on /login as an `error` code,
 * never as provider text: `error_description` is attacker-influencable content
 * and has no business being rendered.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const providerError = searchParams.get('error')

  const next = safeNextPath(searchParams.get('next'))

  // Behind a proxy the forwarded host is the user-facing one; origin is the
  // internal address and would send the user somewhere unreachable.
  const forwardedHost = request.headers.get('x-forwarded-host')
  const isLocal = process.env.NODE_ENV === 'development'
  const base = !isLocal && forwardedHost ? `https://${forwardedHost}` : origin

  // Closing the provider's consent screen is a decision, not a fault — it gets
  // a quieter message than a genuine failure.
  if (providerError) {
    const code = providerError === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed'
    return NextResponse.redirect(`${base}/login?error=${code}`)
  }

  if (!code) {
    return NextResponse.redirect(`${base}/login?error=oauth_failed`)
  }

  const supabase = createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${base}/login?error=oauth_failed`)
  }

  // Same bookkeeping a password sign-in does, so an OAuth session is revocable
  // from the device list rather than invisible to it (§13.6).
  const ip = clientIp(request.headers)
  await recordSession(supabase, {
    ip: ip === 'unknown' ? null : ip,
    userAgent: request.headers.get('user-agent'),
  })

  return NextResponse.redirect(`${base}${next}`)
}
