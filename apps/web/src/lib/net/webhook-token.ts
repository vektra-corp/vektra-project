import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Trigger tokens for webhook-driven workflows.
 *
 * Stored as a SHA-256 hash (00025), the way an API key should be: reading the
 * row tells an attacker nothing, and the plaintext is shown exactly once, when
 * it is minted. No salt and no KDF — unlike a password this is 256 bits of
 * randomness, so there is no dictionary to attack and a slow hash would only
 * cost latency on every inbound call.
 */

export function mintWebhookToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashWebhookToken(token) }
}

export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Compare two hashes without leaking where they differ.
 *
 * The lookup is by hash so the database has already done the matching; this
 * guards the confirmation step, which is cheap to make constant-time and
 * awkward to reason about if it is not.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
