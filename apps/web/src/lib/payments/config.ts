/**
 * Gateway credentials.
 *
 * This module and `razorpay.ts` are the only places in the web app that read a
 * payment secret (§13.10). Nothing here is exported to a client component, and
 * the key id is deliberately read from the server-side variable rather than the
 * `NEXT_PUBLIC_` one — the public copy exists for Checkout in the browser, and
 * treating it as the source of truth here would mean a mis-set public var could
 * silently redirect server-to-server calls at a different account.
 */

/** Missing configuration is a deployment fault, not a customer-visible error. */
export class PaymentConfigError extends Error {
  readonly code = 'PAYMENT_NOT_CONFIGURED'
  constructor(missing: string[]) {
    super(`Razorpay is not configured: missing ${missing.join(', ')}`)
    this.name = 'PaymentConfigError'
  }
}

export interface RazorpayCredentials {
  keyId: string
  keySecret: string
  webhookSecret: string
}

function read(name: string): string {
  return (process.env[name] ?? '').trim()
}

/**
 * Credentials, or a thrown error naming exactly what is absent.
 *
 * Fail closed (§2): a half-configured gateway must not reach the point of
 * creating a subscription the webhook can then never verify.
 */
export function razorpayCredentials(): RazorpayCredentials {
  const keyId = read('RAZORPAY_KEY_ID')
  const keySecret = read('RAZORPAY_KEY_SECRET')
  const webhookSecret = read('RAZORPAY_WEBHOOK_SECRET')

  const missing: string[] = []
  if (!keyId) missing.push('RAZORPAY_KEY_ID')
  if (!keySecret) missing.push('RAZORPAY_KEY_SECRET')
  if (!webhookSecret) missing.push('RAZORPAY_WEBHOOK_SECRET')
  if (missing.length > 0) throw new PaymentConfigError(missing)

  return { keyId, keySecret, webhookSecret }
}

/** Only the webhook secret, so the route can verify before it does anything else. */
export function razorpayWebhookSecret(): string {
  const secret = read('RAZORPAY_WEBHOOK_SECRET')
  if (!secret) throw new PaymentConfigError(['RAZORPAY_WEBHOOK_SECRET'])
  return secret
}

/**
 * Whether checkout can be offered at all.
 *
 * The billing page calls this to decide between rendering plan options and
 * saying the gateway is unavailable. A button that cannot complete a payment is
 * worse than no button.
 */
export function razorpayConfigured(): boolean {
  return Boolean(read('RAZORPAY_KEY_ID') && read('RAZORPAY_KEY_SECRET') && read('RAZORPAY_WEBHOOK_SECRET'))
}

/** Test-mode keys are prefixed `rzp_test_`. Surfaced in the UI so nobody mistakes a sandbox charge for a real one. */
export function razorpayIsTestMode(): boolean {
  return read('RAZORPAY_KEY_ID').startsWith('rzp_test_')
}
