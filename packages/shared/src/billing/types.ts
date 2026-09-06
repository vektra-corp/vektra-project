/**
 * Billing vocabulary shared by both apps.
 *
 * Everything here is pure data — no I/O, no SDK types. The gateway clients live
 * in `apps/web/src/lib/payments`, which is the only place that holds a secret.
 */

/** A payment gateway we actually talk to. `manual` is an operator grant. */
export const PAYMENT_PROVIDERS = ['razorpay', 'paypal'] as const
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number]

export const SUBSCRIPTION_PROVIDERS = [...PAYMENT_PROVIDERS, 'manual'] as const
export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number]

export function isPaymentProvider(value: unknown): value is PaymentProvider {
  return typeof value === 'string' && (PAYMENT_PROVIDERS as readonly string[]).includes(value)
}

export const BILLING_INTERVALS = ['monthly', 'annual'] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

/**
 * How an organization came to have the plan it has.
 *
 * `paid` is the only value a customer action can produce. Keeping the operator
 * grants separate is what stops a comped upgrade being counted as revenue.
 */
export const ENTITLEMENT_SOURCES = [
  'paid',
  'trial',
  'early_access',
  'comp',
  'starter_default',
] as const
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number]

export const SUBSCRIPTION_STATUSES = [
  'pending',
  'authenticated',
  'active',
  'past_due',
  'paused',
  'cancelled',
  'expired',
  'lapsed',
] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/** Statuses that still grant access. Anything else falls back to Starter. */
export const LIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'authenticated',
  'active',
  'past_due',
]

export const PAYMENT_STATUSES = [
  'initiated',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'cancelled',
] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/** The only payment status that grants anything. */
export const GRANTING_PAYMENT_STATUS: PaymentStatus = 'captured'

export const TAX_TREATMENTS = [
  'intra_state',
  'inter_state',
  'export_lut',
  'export_with_igst',
] as const
export type TaxTreatment = (typeof TAX_TREATMENTS)[number]
