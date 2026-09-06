import 'server-only'

/**
 * Process-wide cache of the project's JWT signing keys.
 *
 * `getClaims()` verifies an access token locally with WebCrypto instead of
 * asking the auth server who the caller is — but it needs the public key to do
 * it, and it caches that key on the *client instance*. Our server client is
 * constructed per call (it has to be: it closes over this request's cookies),
 * so every request would start with an empty cache and fetch the JWKS again,
 * trading one network round trip for another.
 *
 * Holding the keys here instead makes the exchange worthwhile: one fetch per
 * server process per TTL, and every request after that verifies with no network
 * at all.
 *
 * The TTL matches auth-js's own (10 minutes), so a rotated signing key is picked
 * up on the same schedule as if auth-js were caching it.
 */

interface Jwk {
  kid?: string
  [key: string]: unknown
}

const TTL_MS = 10 * 60_000

let cached: { keys: Jwk[]; fetchedAt: number } | null = null
/** Concurrent misses share one fetch rather than starting a stampede. */
let inflight: Promise<Jwk[]> | null = null

async function fetchJwks(): Promise<Jwk[]> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`
  const response = await fetch(url, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
    // Next would otherwise cache this in the Data Cache, where it would outlive
    // the TTL enforced here.
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`)

  const body = (await response.json()) as { keys?: Jwk[] }
  if (!body.keys?.length) throw new Error('JWKS response contained no keys')
  return body.keys
}

/**
 * The signing keys, or null if they cannot be fetched.
 *
 * Null is not a failure the caller has to handle specially: `getClaims()` falls
 * back to fetching the JWKS itself, and then to `getUser()`, so verification
 * still happens either way. Only the saving is lost.
 */
export async function getSigningKeys(): Promise<Jwk[] | null> {
  const now = Date.now()
  if (cached && cached.fetchedAt + TTL_MS > now) return cached.keys

  if (!inflight) {
    inflight = fetchJwks()
      .then((keys) => {
        cached = { keys, fetchedAt: Date.now() }
        return keys
      })
      .finally(() => {
        inflight = null
      })
  }

  try {
    return await inflight
  } catch {
    // A stale key still verifies tokens signed before the rotation, and is a
    // better answer than forcing every request onto the network.
    return cached?.keys ?? null
  }
}
