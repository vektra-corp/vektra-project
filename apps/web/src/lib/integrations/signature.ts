import { createHmac } from 'node:crypto'

/**
 * HMAC signing for outbound webhooks (§6.6).
 *
 * Split out from the dispatcher so it can be tested — that module is
 * `server-only`. This is what a customer's receiver verifies against, so its
 * exact shape is a published contract: changing the separator or the order
 * silently breaks every integration built on it. The construction is the
 * Stripe-style `{timestamp}.{body}` for that reason — receivers can reuse
 * verification code they already have.
 *
 * The timestamp is inside the signed material rather than merely alongside it,
 * so a captured request cannot be replayed forever: a receiver rejects one
 * whose timestamp is too old, and an attacker cannot rewrite it without
 * invalidating the signature.
 *
 * That concatenation is ambiguous if a timestamp may contain a dot — signing
 * ("1", "23.{body}") and ("1.23", "{body}") would produce the same digest.
 * Nothing reachable does that, since we generate the timestamp ourselves as
 * whole seconds, but "nothing reachable does that" is a property worth
 * enforcing rather than relying on, so the format is checked here.
 */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  if (!/^\d+$/.test(timestamp)) {
    throw new Error('Webhook timestamp must be digits only')
  }
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}
