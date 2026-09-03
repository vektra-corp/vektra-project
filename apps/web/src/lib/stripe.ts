import 'server-only'

import Stripe from 'stripe'

/**
 * Stripe client. Server-side only — the secret key must never reach the bundle.
 * The publishable key is the one the browser uses, via NEXT_PUBLIC_.
 */
let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (cached) return cached

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set')

  cached = new Stripe(secretKey, {
    apiVersion: '2024-06-20',
    typescript: true,
    appInfo: { name: 'Project Management SaaS', version: '0.1.0' },
  })
  return cached
}

/**
 * Stripe subscription status -> our organization status.
 *
 * Anything that is not clearly good standing suspends the tenant, so a failed
 * payment cannot silently grant continued access.
 */
export function orgStatusForSubscription(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'active':
    case 'past_due': // Still in the dunning window; access continues.
      return 'active'
    case 'trialing':
      return 'trial'
    case 'canceled':
    case 'incomplete_expired':
      return 'churned'
    default:
      return 'suspended'
  }
}

/** Events the webhook acts on. Anything else is acknowledged and ignored. */
export const HANDLED_STRIPE_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
] as const
