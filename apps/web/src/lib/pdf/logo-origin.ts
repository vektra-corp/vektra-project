/**
 * The origin check for organisation logos.
 *
 * Split out from `logo.ts` purely so it can be tested: that module is marked
 * `server-only`, which makes it unimportable from vitest. This check IS the
 * security boundary for logo fetching, so it is the part that most needs tests.
 */

/**
 * Whether a URL points at this project's own Supabase Storage.
 *
 * An allowlist rather than a private-address check: a logo can only ever live
 * in our own storage, so anything else is refused outright instead of reasoned
 * about.
 */
export function isOwnStorageUrl(raw: string, supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false

  let url: URL
  let base: URL
  try {
    url = new URL(raw)
    base = new URL(supabaseUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  // Exact host match. A suffix or `includes` check would accept
  // `evil-project.supabase.co` and, worse, `ourproject.supabase.co.attacker.com`.
  if (url.hostname !== base.hostname) return false
  return url.pathname.startsWith('/storage/v1/object/')
}
