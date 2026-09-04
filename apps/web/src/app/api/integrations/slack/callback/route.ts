import { timingSafeEqual } from 'node:crypto'
import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { DEFAULT_INTEGRATION_EVENTS } from '@pm/shared/constants'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth/context'
import { exchangeCode } from '@/lib/integrations/slack'
import { createAdminClient } from '@/lib/supabase/admin'
import { STATE_COOKIE } from '../authorize/route'

/**
 * Finish the Slack OAuth flow (§12).
 *
 * Three things have to hold before a token is stored, and all three are checked
 * here rather than assumed from the fact that Slack redirected us:
 *
 *  1. The `state` matches the cookie set when the flow began — otherwise this
 *     is a redirect someone else initiated.
 *  2. The caller is still an authenticated admin of the org named in that
 *     cookie. The cookie says which org; it does not grant access to it.
 *  3. Slack actually returned a token. It answers 200 with `{ ok: false }` for
 *     application errors, which a status check alone would miss.
 *
 * The token is written through `save_integration`, which encrypts it inside the
 * database (00027). It is never stored, logged, or returned in plaintext.
 */

export const runtime = 'nodejs'

function back(request: NextRequest, orgSlug: string, status: string) {
  const url = new URL(`/${orgSlug}/settings/integrations`, request.nextUrl.origin)
  url.searchParams.set('slack', status)
  return NextResponse.redirect(url)
}

/** Compare without leaking where two states diverge. */
function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export async function GET(request: NextRequest) {
  const store = cookies()
  const raw = store.get(STATE_COOKIE)?.value
  // Single-use: whatever happens next, this state must not work twice.
  store.delete(STATE_COOKIE)

  if (!raw) {
    return NextResponse.redirect(new URL('/', request.nextUrl.origin))
  }

  let expected: { state?: string; orgSlug?: string }
  try {
    expected = JSON.parse(raw)
  } catch {
    return NextResponse.redirect(new URL('/', request.nextUrl.origin))
  }

  const orgSlug = expected.orgSlug
  if (!orgSlug || !expected.state) {
    return NextResponse.redirect(new URL('/', request.nextUrl.origin))
  }

  // Slack sends `error=access_denied` when someone cancels the install. That is
  // a normal outcome, not a failure to report loudly.
  if (request.nextUrl.searchParams.get('error')) {
    return back(request, orgSlug, 'cancelled')
  }

  const state = request.nextUrl.searchParams.get('state') ?? ''
  if (!statesMatch(state, expected.state)) {
    return back(request, orgSlug, 'invalid_state')
  }

  const auth = await getAuthContext(orgSlug)
  if (!auth || !(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) {
    return back(request, orgSlug, 'forbidden')
  }

  const code = request.nextUrl.searchParams.get('code')
  if (!code) return back(request, orgSlug, 'failed')

  const redirectUri = new URL('/api/integrations/slack/callback', request.nextUrl.origin).toString()
  const exchanged = await exchangeCode(code, redirectUri)
  if (!exchanged.ok || !exchanged.data?.access_token) {
    return back(request, orgSlug, 'failed')
  }

  const key = process.env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return back(request, orgSlug, 'not_configured')

  const db = createAdminClient()
  const { error } = await db.rpc('save_integration', {
    p_org: auth.orgId,
    p_provider: 'slack',
    p_access_token: exchanged.data.access_token,
    p_config: {
      teamId: exchanged.data.team?.id ?? null,
      teamName: exchanged.data.team?.name ?? null,
      // No channel yet: the admin picks one in settings. Posting starts only
      // once they have, so a fresh install cannot spam a default channel.
      channelId: null,
      channelName: null,
      events: [...DEFAULT_INTEGRATION_EVENTS],
    },
    p_key: key,
    p_connected_by: auth.userId,
  })

  return back(request, orgSlug, error ? 'failed' : 'connected')
}
