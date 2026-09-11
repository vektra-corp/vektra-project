import type { SubscriptionStatus } from '@pm/shared/billing'
import { NextResponse, type NextRequest } from 'next/server'
import { callApplyPendingChange } from '@/lib/inngest/billing-rpc'
import { verifyWebhookSignature } from '@/lib/payments/razorpay'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Razorpay subscription webhooks — the only path that grants entitlement.
 *
 * Nothing the browser reports is trusted. Checkout's handler callback tells the
 * post-checkout page the customer got through, and that is all it does; money
 * is only ever recognised here, from a request carrying a valid HMAC computed
 * over the raw body with the webhook secret.
 *
 * The shape of this route follows the workflow webhook (00025) and §13.4:
 *
 *  - Signature is verified BEFORE the body is parsed, over the exact bytes
 *    received. Re-serialising parsed JSON changes key order and the digest with
 *    it, which is the classic way this breaks.
 *  - Failures are recorded, not just rejected. A burst of invalid signatures is
 *    someone probing the endpoint, and `payment_webhook_events.signature_valid`
 *    is what makes that visible (§13.11).
 *  - Replays are a no-op by construction: UNIQUE(provider, provider_event_id)
 *    means a redelivery collides in the database rather than double-crediting.
 *  - 2xx is returned for anything we have durably recorded, including events we
 *    ignore. A non-2xx makes Razorpay retry, so returning one for "not
 *    interesting" would earn an escalating retry storm for no reason.
 */

export const runtime = 'nodejs'

/** Generous for a gateway payload, far short of a memory problem. */
const MAX_BODY_BYTES = 256 * 1024

const received = () => NextResponse.json({ received: true }, { status: 200 })

/**
 * Razorpay subscription state -> ours.
 *
 * `halted` is the one worth reading twice: it means the retry schedule is
 * exhausted, which is our `lapsed` — access falls back to Starter via
 * `org_entitlements()` rather than anything being deleted.
 */
const SUBSCRIPTION_STATUS_BY_EVENT: Record<string, SubscriptionStatus> = {
  'subscription.authenticated': 'authenticated',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.pending': 'past_due',
  'subscription.halted': 'lapsed',
  'subscription.paused': 'paused',
  'subscription.resumed': 'active',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'expired',
}

interface RazorpayEventBody {
  event?: string
  created_at?: number
  payload?: {
    subscription?: { entity?: Record<string, unknown> }
    payment?: { entity?: Record<string, unknown> }
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Razorpay timestamps are epoch seconds. */
const epoch = (v: unknown): string | null => {
  const n = num(v)
  return n === null ? null : new Date(n * 1000).toISOString()
}

export async function POST(request: NextRequest) {
  // Bound by source address: unlike the workflow route there is no per-tenant
  // token here, and the credential is a signature we have not checked yet.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const limit = await checkRateLimit('webhook', `rzp:${ip}`)
  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many requests', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' },
      { status: 413 },
    )
  }

  const signature = request.headers.get('x-razorpay-signature')

  let signatureValid = false
  try {
    signatureValid = verifyWebhookSignature(raw, signature)
  } catch {
    // The webhook secret is not configured. That is our fault, not the
    // caller's, and a 500 correctly makes Razorpay retry once we have fixed it.
    return NextResponse.json(
      { error: 'Webhook not configured', code: 'PAYMENT_NOT_CONFIGURED' },
      { status: 500 },
    )
  }

  let body: RazorpayEventBody = {}
  try {
    body = JSON.parse(raw) as RazorpayEventBody
  } catch {
    // Unparseable and unsigned is noise; unparseable but signed would be a
    // Razorpay bug worth seeing. Either way it is logged below, not processed.
  }

  const db = createAdminClient()

  // The delivery id is Razorpay's own dedup handle and is present on every
  // delivery. Falling back to the digest keeps a malformed delivery loggable
  // without letting it collide with a real event.
  const eventId =
    request.headers.get('x-razorpay-event-id') ?? `unsigned:${raw.length}:${signature ?? 'none'}`
  const eventType = str(body.event) ?? 'unknown'

  const subscriptionEntity = body.payload?.subscription?.entity ?? {}
  const paymentEntity = body.payload?.payment?.entity ?? {}
  const providerSubscriptionId = str(subscriptionEntity.id)
  const eventAt = epoch(body.created_at)

  // Record first, act second. An event we crash on must still be in the log.
  const { data: logged, error: logError } = await db
    .from('payment_webhook_events')
    .insert({
      provider: 'razorpay',
      provider_event_id: eventId,
      event_type: eventType,
      event_at: eventAt,
      signature_valid: signatureValid,
      status: signatureValid ? 'received' : 'ignored',
      payload: body as never,
    })
    .select('id')
    .single()

  // 23505: this delivery has already been recorded. A retry, and already
  // handled — acknowledge so Razorpay stops resending.
  if (logError?.code === '23505') return received()
  if (logError) {
    // We could not durably record it. Do NOT acknowledge: a retry is what we
    // want, and silently dropping a charge event is the worst outcome here.
    return NextResponse.json({ error: 'Could not record event' }, { status: 500 })
  }

  if (!signatureValid) return received()

  try {
    await handleEvent(db, {
      eventType,
      eventAt,
      providerSubscriptionId,
      subscriptionEntity,
      paymentEntity,
      webhookEventId: logged.id,
    })
    await db
      .from('payment_webhook_events')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', logged.id)
  } catch (error) {
    await db
      .from('payment_webhook_events')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', logged.id)
    // Ask for a retry. The unique index makes a duplicate delivery safe.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  return received()
}

async function handleEvent(
  db: ReturnType<typeof createAdminClient>,
  input: {
    eventType: string
    eventAt: string | null
    providerSubscriptionId: string | null
    subscriptionEntity: Record<string, unknown>
    paymentEntity: Record<string, unknown>
    webhookEventId: string
  },
) {
  const { eventType, eventAt, providerSubscriptionId, subscriptionEntity, paymentEntity } = input

  if (!providerSubscriptionId) return

  const { data: subscription } = await db
    .from('subscriptions')
    .select('id, organization_id, plan_id, provider_state_at, currency, unit_amount_minor, seats')
    .eq('provider', 'razorpay')
    .eq('provider_subscription_id', providerSubscriptionId)
    .maybeSingle()

  // An event for a subscription we have no row for. Recorded above, ignored
  // here — it belongs to another environment sharing this Razorpay account,
  // which is exactly what happens when staging and production both point at
  // test mode.
  if (!subscription) return

  await db
    .from('payment_webhook_events')
    .update({ organization_id: subscription.organization_id, subscription_id: subscription.id })
    .eq('id', input.webhookEventId)

  // Out-of-order guard (00037): a delayed 'activated' must not overwrite a
  // newer 'halted'. Applied on the provider's own clock, not ours.
  const isStale =
    eventAt !== null &&
    subscription.provider_state_at !== null &&
    new Date(eventAt) < new Date(subscription.provider_state_at)

  const nextStatus = SUBSCRIPTION_STATUS_BY_EVENT[eventType]

  if (nextStatus && !isStale) {
    const endedAt = eventAt ?? new Date().toISOString()
    const customerId = str(subscriptionEntity.customer_id)

    const patch = {
      status: nextStatus,
      provider_state_at: eventAt,
      current_period_start: epoch(subscriptionEntity.current_start),
      current_period_end: epoch(subscriptionEntity.current_end),
      ...(customerId ? { provider_customer_id: customerId } : {}),
      ...(nextStatus === 'cancelled' ? { cancelled_at: endedAt } : {}),
      ...(nextStatus === 'expired' || nextStatus === 'lapsed' ? { ended_at: endedAt } : {}),
      // Checkout is finished either way; the handle stops being useful.
      ...(nextStatus !== 'pending' ? { checkout_token_hash: null } : {}),
    }

    const { error } = await db.from('subscriptions').update(patch).eq('id', subscription.id)
    if (error) throw new Error(`subscription update failed: ${error.message}`)
  }

  // --- The ledger ------------------------------------------------------------
  //
  // A payment row is written for any event carrying a payment entity, captured
  // or failed alike: a failed charge is the row an operator most needs when a
  // customer writes in (00037).

  // A charge for a new cycle is the moment a scheduled price change has
  // genuinely taken effect — the gateway has just debited the new amount — so
  // this is where the snapshot on the subscription is allowed to move (00047).
  if (eventType === 'subscription.charged') {
    await callApplyPendingChange(db, subscription.id)
  }

  const providerPaymentId = str(paymentEntity.id)
  if (!providerPaymentId) return

  const captured = eventType === 'subscription.charged' || str(paymentEntity.status) === 'captured'
  const now = eventAt ?? new Date().toISOString()

  const { error: paymentError } = await db.from('payments').upsert(
    {
      organization_id: subscription.organization_id,
      subscription_id: subscription.id,
      plan_id: subscription.plan_id,
      provider: 'razorpay',
      provider_payment_id: providerPaymentId,
      provider_invoice_id: str(paymentEntity.invoice_id),
      provider_order_id: str(paymentEntity.order_id),
      provider_subscription_id: providerSubscriptionId,
      status: captured ? 'captured' : 'failed',
      currency: str(paymentEntity.currency) ?? subscription.currency,
      amount_minor: num(paymentEntity.amount) ?? 0,
      method: str(paymentEntity.method),
      error_code: str(paymentEntity.error_code),
      error_description: str(paymentEntity.error_description),
      billing_period_start: epoch(subscriptionEntity.current_start),
      billing_period_end: epoch(subscriptionEntity.current_end),
      provider_payload: paymentEntity as never,
      captured_at: captured ? now : null,
      failed_at: captured ? null : now,
    },
    // Idempotent on the gateway's own payment id, so a redelivery updates the
    // existing ledger row instead of inventing a second one.
    { onConflict: 'provider,provider_payment_id' },
  )
  if (paymentError) throw new Error(`payment upsert failed: ${paymentError.message}`)
}

/** A GET is almost always someone pasting the URL into a browser. Say so. */
export function GET() {
  return NextResponse.json(
    { error: 'Use POST — this endpoint receives Razorpay webhooks', code: 'METHOD_NOT_ALLOWED' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
