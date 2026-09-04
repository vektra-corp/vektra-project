import { randomBytes } from 'node:crypto'
import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { SLACK_SCOPES } from '@pm/shared/constants'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth/context'

/**
 * Begin the Slack OAuth flow (§12).
 *
 * The `state` parameter is the CSRF defence for OAuth, and it only works if it
 * is unguessable AND bound to this browser. So a random value is stored in an
 * httpOnly cookie and echoed to Slack; the callback accepts only a state that
 * matches the cookie. Without that, an attacker could complete an install into
 * their own workspace and have the callback attach it to someone else's
 * organisation.
 *
 * The org slug rides along inside the state cookie rather than in the state
 * parameter, so nothing about which tenant is connecting travels through Slack.
 */

export const runtime = 'nodejs'
export const STATE_COOKIE = 'slack_oauth_state'

export async function GET(request: NextRequest) {
  const orgSlug = request.nextUrl.searchParams.get('org')
  if (!orgSlug) {
    return NextResponse.json({ error: 'Missing organization', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const auth = await getAuthContext(orgSlug)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  // Connecting an integration grants a third party a channel into this org's
  // activity, which is an admin decision.
  if (!(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
  }

  const clientId = process.env.SLACK_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'Slack is not configured on this deployment', code: 'NOT_CONFIGURED' },
      { status: 501 },
    )
  }

  const state = randomBytes(24).toString('base64url')

  cookies().set(STATE_COOKIE, JSON.stringify({ state, orgSlug }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax, not Strict: the callback arrives as a top-level navigation from
    // slack.com, and Strict would withhold the cookie exactly then.
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  const redirectUri = new URL('/api/integrations/slack/callback', request.nextUrl.origin).toString()
  const authorize = new URL('https://slack.com/oauth/v2/authorize')
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('scope', SLACK_SCOPES.join(','))
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('state', state)

  return NextResponse.redirect(authorize)
}
