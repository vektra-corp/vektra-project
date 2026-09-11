/**
 * The address this deployment is reachable at.
 *
 * Read in ten places, previously as a bare `process.env.NEXT_PUBLIC_APP_URL ??
 * ''`, which has two failure modes that both end the same way — an email goes
 * out carrying a link nobody can follow:
 *
 *   unset      → `''`, so links become `/accept-invite?...` with no origin
 *   localhost  → fine in development, useless to anyone who is not on the
 *                machine that sent the mail
 *
 * Neither announces itself. The invite still "sends", the row still says
 * `emailed_at`, and the only symptom is a colleague saying the link does not
 * work — which is exactly how the invite flow stayed broken for a day.
 *
 * Background jobs have no request to fall back on, so for them the environment
 * variable is the only source of truth. That makes it worth checking rather
 * than defaulting.
 */

/** The configured origin, without a trailing slash. Empty when unset. */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
}

/**
 * Whether this origin can actually be opened by someone else.
 *
 * `localhost` and the loopback addresses are correct in development and wrong
 * in every deployed environment, so this is about reachability, not validity.
 */
export function isLocalAppUrl(url = appUrl()): boolean {
  if (!url) return true
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    // Unparseable is not reachable either.
    return true
  }
}

/**
 * A human-readable reason this deployment cannot send working links, or null.
 *
 * Only speaks up outside development: on a developer's machine a localhost
 * origin is the right answer, and refusing to send there would break the very
 * flow this exists to protect.
 *
 * Returned rather than thrown so the caller decides — an invite should refuse
 * outright, while a notification email is still worth sending without a button.
 */
export function appUrlProblem(): string | null {
  if (process.env.NODE_ENV !== 'production') return null

  const url = appUrl()
  if (!url) {
    return 'NEXT_PUBLIC_APP_URL is not set, so invitation links cannot be built.'
  }
  if (isLocalAppUrl(url)) {
    return `NEXT_PUBLIC_APP_URL is set to ${url}, which only works on the server itself.`
  }
  return null
}
