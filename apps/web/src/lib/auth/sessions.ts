import 'server-only'

import { createHash } from 'node:crypto'
import type { Database } from '@pm/db/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Session tracking (§13.6).
 *
 * A row per sign-in, so someone can see where they are signed in and revoke a
 * device they no longer recognise.
 *
 * The link that makes revocation real is `session_id`, taken from the JWT's own
 * claim: it names GoTrue's session, and deleting that is what invalidates the
 * refresh token. Recording device details without it would produce a list that
 * looks like session management and revokes nothing.
 */

export interface RequestIdentity {
  ip: string | null
  userAgent: string | null
}

/**
 * A short, human label for a device.
 *
 * Deliberately coarse. The point is "is this me?", and a full user-agent string
 * answers that worse than "Chrome on macOS" does. The raw string is stored
 * alongside for when the coarse version is not enough.
 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'

  const browser =
    /edg\//i.test(userAgent) ? 'Edge'
    : /opr\/|opera/i.test(userAgent) ? 'Opera'
    : /chrome|crios/i.test(userAgent) ? 'Chrome'
    : /firefox|fxios/i.test(userAgent) ? 'Firefox'
    : /safari/i.test(userAgent) ? 'Safari'
    : 'Browser'

  const platform =
    /iphone|ipad|ipod/i.test(userAgent) ? 'iOS'
    : /android/i.test(userAgent) ? 'Android'
    : /mac os x|macintosh/i.test(userAgent) ? 'macOS'
    : /windows/i.test(userAgent) ? 'Windows'
    : /linux/i.test(userAgent) ? 'Linux'
    : null

  return platform ? `${browser} on ${platform}` : browser
}

/**
 * Fingerprint of the request, for §13.6's "flag if it changes mid-session".
 *
 * Hashed rather than stored raw: it is only ever compared, never read back, and
 * an IP address paired with a user-agent is more identifying than either alone.
 */
export function fingerprint(identity: RequestIdentity): string {
  return createHash('sha256')
    .update(`${identity.ip ?? ''}|${identity.userAgent ?? ''}`)
    .digest('hex')
}

/**
 * Record the session that has just been established.
 *
 * Best-effort by design: a failure here must not stop someone signing in. The
 * consequence of losing a row is an incomplete device list, which is a great
 * deal better than an outage on the login path.
 */
export async function recordSession(
  supabase: SupabaseClient<Database>,
  identity: RequestIdentity,
): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    if (!session) return

    const claims = JSON.parse(
      Buffer.from(session.access_token.split('.')[1] ?? '', 'base64url').toString(),
    ) as { session_id?: string; org_id?: string }

    await supabase.from('user_sessions').upsert(
      {
        user_id: session.user.id,
        organization_id: claims.org_id ?? null,
        session_id: claims.session_id ?? null,
        device: describeDevice(identity.userAgent),
        ip_address: identity.ip,
        user_agent: identity.userAgent?.slice(0, 500) ?? null,
        fingerprint: fingerprint(identity),
        last_active_at: new Date().toISOString(),
        revoked_at: null,
      },
      // Signing in again on the same GoTrue session should refresh the row, not
      // add a second one for the same device.
      { onConflict: 'session_id' },
    )
  } catch {
    // Intentionally silent. See the note above about the login path.
  }
}
