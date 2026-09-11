import { createHmac, timingSafeEqual } from 'node:crypto'
import type { BillingInterval } from '@pm/shared/billing'
import { razorpayCredentials, razorpayWebhookSecret } from './config'

/**
 * Razorpay REST client.
 *
 * Written against `fetch` rather than the `razorpay` npm package deliberately:
 * the SDK is a thin wrapper over these same endpoints, bundles a request
 * library we would otherwise not ship, and returns `any`. Five typed calls are
 * cheaper to audit than a dependency that holds the account secret.
 *
 * Every function here is server-only. The secret never crosses to a client
 * component, and the key id that Checkout needs in the browser travels as
 * `NEXT_PUBLIC_RAZORPAY_KEY_ID`, which is publishable by design.
 */

const API_BASE = 'https://api.razorpay.com/v1'

/** A gateway call that came back non-2xx. Carries Razorpay's own code for the ledger. */
export class RazorpayError extends Error {
  readonly code = 'PAYMENT_GATEWAY_ERROR'
  constructor(
    message: string,
    readonly status: number,
    readonly providerCode?: string,
    readonly providerDescription?: string,
  ) {
    super(message)
    this.name = 'RazorpayError'
  }
}

interface RazorpayErrorBody {
  error?: { code?: string; description?: string; reason?: string }
}

/**
 * One authenticated call.
 *
 * Basic auth over TLS is what Razorpay offers; there is no signed-request mode
 * for the management API. The timeout matters more than it looks: this runs
 * inside a server action, and a gateway that hangs would otherwise hold a
 * serverless invocation open until the platform kills it, after which we would
 * have no idea whether a subscription was created.
 */
async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = { method: 'GET' },
): Promise<T> {
  const { keyId, keySecret } = razorpayCredentials()
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000)

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError'
    throw new RazorpayError(
      aborted ? 'Razorpay did not respond in time' : 'Could not reach Razorpay',
      504,
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await response.text()

  if (!response.ok) {
    let parsed: RazorpayErrorBody = {}
    try {
      parsed = JSON.parse(text) as RazorpayErrorBody
    } catch {
      // A non-JSON body from a gateway is itself worth reporting verbatim-ish,
      // but only the status reaches the customer.
    }
    throw new RazorpayError(
      parsed.error?.description ?? `Razorpay returned ${response.status}`,
      response.status,
      parsed.error?.code,
      parsed.error?.description,
    )
  }

  return JSON.parse(text) as T
}

// --- Plans --------------------------------------------------------------------

export interface RazorpayPlan {
  id: string
  item: { id: string; name: string; amount: number; currency: string }
}

/**
 * Create a gateway plan at an exact amount.
 *
 * Razorpay treats a plan's amount as immutable, which is why `provider_plan_refs`
 * caches these rather than creating one per checkout. `amountMinor` is the
 * TAX-INCLUSIVE figure — the gateway charges one number, and the invoice
 * decomposes it afterwards (00037).
 */
export async function createPlan(input: {
  name: string
  amountMinor: number
  currency: string
  interval: BillingInterval
  notes?: Record<string, string>
}): Promise<RazorpayPlan> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 1) {
    throw new RazorpayError('Plan amount must be a positive integer in minor units', 400)
  }
  return call<RazorpayPlan>('/plans', {
    method: 'POST',
    body: {
      period: input.interval === 'annual' ? 'yearly' : 'monthly',
      interval: 1,
      item: {
        name: input.name,
        amount: input.amountMinor,
        currency: input.currency,
      },
      notes: input.notes ?? {},
    },
  })
}

// --- Subscriptions ------------------------------------------------------------

export interface RazorpaySubscription {
  id: string
  plan_id: string
  status: string
  quantity: number
  customer_id?: string
  short_url?: string
  current_start?: number | null
  current_end?: number | null
  charge_at?: number | null
}

/**
 * Register a mandate for a plan.
 *
 * `total_count` is how many cycles the mandate covers — Razorpay requires a
 * finite number, so "until cancelled" is expressed as a long horizon rather
 * than omitted. Ten years of monthly debits, or ten annual ones.
 *
 * `quantity` is the seat count, and it is passed from a server-side
 * `billable_seats()` result. A client-supplied quantity would be a way to buy
 * fifty seats at the price of one.
 */
export async function createSubscription(input: {
  planId: string
  seats: number
  interval: BillingInterval
  notifyCustomer?: boolean
  notes?: Record<string, string>
}): Promise<RazorpaySubscription> {
  if (!Number.isInteger(input.seats) || input.seats < 1) {
    throw new RazorpayError('Seat count must be a positive integer', 400)
  }
  return call<RazorpaySubscription>('/subscriptions', {
    method: 'POST',
    body: {
      plan_id: input.planId,
      total_count: input.interval === 'annual' ? 10 : 120,
      quantity: input.seats,
      // We send our own mail from Resend with the invoice attached; letting the
      // gateway also mail the customer would mean two different receipts.
      customer_notify: input.notifyCustomer ? 1 : 0,
      notes: input.notes ?? {},
    },
  })
}

export async function fetchSubscription(id: string): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(id)}`)
}

/**
 * Cancel at the gateway.
 *
 * `atCycleEnd` is the default because a customer who cancels mid-period has
 * already paid for that period, and revoking access immediately would be taking
 * money for nothing.
 */
export async function cancelSubscription(
  id: string,
  options: { atCycleEnd?: boolean } = {},
): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { cancel_at_cycle_end: options.atCycleEnd === false ? 0 : 1 },
  })
}

// --- Signature verification ---------------------------------------------------

/**
 * Constant-time hex digest comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so the length is checked first
 * — and since both sides are fixed-width SHA-256 hex, an unequal length only
 * ever means a malformed header.
 */
function digestsMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(received, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Verify an inbound webhook.
 *
 * The digest is over the RAW request body. Parsing first and re-serialising
 * would change key order and whitespace, and the signature would never match —
 * this is the single most common way a webhook integration is broken.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', razorpayWebhookSecret()).update(rawBody).digest('hex')
  return digestsMatch(expected, signature)
}

/**
 * Verify the handler callback Checkout posts back in the browser.
 *
 * Signed with the KEY SECRET, not the webhook secret, and for a subscription
 * the payload is `payment_id|subscription_id` — the reverse of the order used
 * for one-off orders. Getting that pair backwards produces a valid-looking
 * HMAC that never matches.
 *
 * This is a UX signal only. It tells the post-checkout page the customer got
 * through, and nothing more: entitlement is granted by the webhook, from
 * Razorpay's own servers, because anything the browser hands us is attacker-
 * controlled (§13.4).
 */
export function verifyCheckoutSignature(input: {
  paymentId: string
  subscriptionId: string
  signature: string
}): boolean {
  const { keySecret } = razorpayCredentials()
  const expected = createHmac('sha256', keySecret)
    .update(`${input.paymentId}|${input.subscriptionId}`)
    .digest('hex')
  return digestsMatch(expected, input.signature)
}
