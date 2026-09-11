import { clientIp, safeNextPath } from '@pm/auth/middleware'
import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { recordSession } from '@/lib/auth/sessions'
import { createClient } from '@/lib/supabase/server'

/**
 * Email-link confirmation (invite, magic link, recovery, email change).
 *
 * Distinct from `/auth/callback`, which handles OAuth's PKCE code exchange.
 * These are not the same flow and cannot share a route:
 *
 *   OAuth   — provider redirects back with `?code=...`, exchanged server-side.
 *   Email   — Supabase's own `/auth/v1/verify` endpoint consumes the token and
 *             redirects with the session in the URL FRAGMENT (`#access_token`).
 *
 * A fragment is never sent to the server, so a server route handed an
 * `action_link` sees no code, no token, nothing — and can only conclude the
 * sign-in failed. That is exactly what happened: the invite link verified the
 * user (marking them confirmed) and then bounced to /login?error=oauth_failed,
 * leaving an account that existed, was confirmed, and had no password.
 *
 * The fix is to never hand out `action_link` for email flows. `generateLink`
 * also returns `hashed_token`, which `verifyOtp` accepts server-side — so the
 * session is established here, in cookies, with nothing in the fragment.
 */

/** Types this route will verify. Anything else is refused rather than guessed. */
const ALLOWED_TYPES: EmailOtpType[] = ['invite', 'magiclink', 'recovery', 'email', 'signup']

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)

  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeNextPath(searchParams.get('next'))

  const forwardedHost = request.headers.get('x-forwarded-host')
  const isLocal = process.env.NODE_ENV === 'development'
  const base = !isLocal && forwardedHost ? `https://${forwardedHost}` : origin

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.redirect(`${base}/login?error=invite_expired`)
  }

  const supabase = createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error) {
    // A consumed or expired link is the overwhelmingly common case here, and
    // "ask for a new one" is the only useful thing to say. The provider's own
    // text is not rendered — it is attacker-influencable content (§13.8).
    return NextResponse.redirect(`${base}/login?error=invite_expired`)
  }

  // Same bookkeeping a password sign-in does, so the session is revocable from
  // the device list rather than invisible to it (§13.6).
  const ip = clientIp(request.headers)
  await recordSession(supabase, {
    ip: ip === 'unknown' ? null : ip,
    userAgent: request.headers.get('user-agent'),
  })

  return NextResponse.redirect(`${base}${next}`)
}
