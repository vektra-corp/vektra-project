import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, orgStatusForSubscription } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Stripe webhook (claude.md §9, §13.4).
 *
 * Exempt from CSRF and from the auth middleware: the signature IS the
 * authentication. It uses the service-role client because a webhook has no user
 * session, so every statement scopes itself explicitly by customer or
 * subscription id.
 */

// The raw body is required for signature verification, so this route must not
// be statically optimized or have its body parsed.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const body = await request.text()
  const stripe = getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    // Never echo the verification error — it tells an attacker what to fix.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createAdminClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const orgId = session.metadata?.organization_id
        if (orgId && session.subscription) {
          await supabase
            .from('organizations')
            .update({
              stripe_customer_id: String(session.customer),
              stripe_subscription_id: String(session.subscription),
              status: 'active',
            })
            .eq('id', orgId)
        }
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object
        const priceId = subscription.items.data[0]?.price.id

        // Map the Stripe price back to one of our plans.
        const { data: plan } = priceId
          ? await supabase
              .from('plans')
              .select('id')
              .or(
                `stripe_price_id_monthly.eq.${priceId},stripe_price_id_annual.eq.${priceId}`,
              )
              .maybeSingle()
          : { data: null }

        await supabase
          .from('organizations')
          .update({
            status: orgStatusForSubscription(subscription.status),
            ...(plan ? { plan_id: plan.id } : {}),
          })
          .eq('stripe_subscription_id', subscription.id)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        await supabase
          .from('organizations')
          .update({ status: 'churned', stripe_subscription_id: null })
          .eq('stripe_subscription_id', subscription.id)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object
        await recordBillingEvent(supabase, invoice.customer, 'payment.succeeded', {
          invoice_id: invoice.id,
          amount_paid: invoice.amount_paid,
          currency: invoice.currency,
        })
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object
        // Dunning: Stripe retries on its own schedule. The org is only suspended
        // when the subscription itself moves to unpaid, which arrives as a
        // subscription.updated event.
        await recordBillingEvent(supabase, invoice.customer, 'payment.failed', {
          invoice_id: invoice.id,
          amount_due: invoice.amount_due,
          currency: invoice.currency,
          attempt_count: invoice.attempt_count,
        })
        break
      }

      default:
        // Acknowledged so Stripe stops retrying, but not acted on.
        break
    }
  } catch (error) {
    console.error('[stripe-webhook]', event.type, error)
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

/** Write a billing event onto the org's event stream and audit log. */
async function recordBillingEvent(
  supabase: ReturnType<typeof createAdminClient>,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const customerId = typeof customer === 'string' ? customer : customer?.id
  if (!customerId) return

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  if (!org) return

  await supabase.from('events').insert({
    organization_id: org.id,
    event_type: eventType,
    source: 'integration',
    payload: payload as never,
  })

  await supabase.from('audit_logs').insert({
    organization_id: org.id,
    actor_type: 'system',
    action: eventType,
    resource_type: 'subscription',
    metadata: payload as never,
  })
}
