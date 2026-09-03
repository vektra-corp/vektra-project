'use server'

import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { appError } from '@pm/shared/errors'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth/context'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'

/**
 * Billing actions.
 *
 * All Stripe traffic goes through the server (§2) — the client never holds a
 * key or constructs a checkout session itself, so it cannot choose its own
 * price or quantity.
 */

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

export async function startCheckout(formData: FormData) {
  const auth = await requireAuth()
  if (!ORG_ADMIN_ROLES.includes(auth.orgRole)) {
    throw appError('FORBIDDEN', 'Billing is restricted to owners and admins')
  }

  const planId = formData.get('plan_id')
  if (typeof planId !== 'string') throw appError('VALIDATION_ERROR', 'Missing plan')

  const supabase = createClient()

  const { data: plan } = await supabase
    .from('plans')
    .select('id, name, stripe_price_id_monthly')
    .eq('id', planId)
    .maybeSingle()

  if (!plan?.stripe_price_id_monthly) {
    throw appError('VALIDATION_ERROR', 'That plan is not available for self-service checkout')
  }

  const { data: organization } = await supabase
    .from('organizations')
    .select('id, name, slug, billing_email, stripe_customer_id')
    .eq('id', auth.orgId)
    .single()

  if (!organization) throw appError('NOT_FOUND', 'Organization not found')

  // Seats are billed per member, counted server-side so the quantity cannot be
  // tampered with from the client.
  const { count: seats } = await supabase
    .from('org_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', auth.orgId)

  const stripe = getStripe()

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: plan.stripe_price_id_monthly, quantity: Math.max(seats ?? 1, 1) }],
    ...(organization.stripe_customer_id
      ? { customer: organization.stripe_customer_id }
      : { customer_email: organization.billing_email ?? auth.email ?? undefined }),
    client_reference_id: organization.id,
    // Read back in the webhook to attach the subscription to the right tenant.
    metadata: { organization_id: organization.id, plan_id: plan.id },
    subscription_data: {
      metadata: { organization_id: organization.id },
    },
    success_url: `${appUrl()}/${organization.slug}/settings/billing?checkout=success`,
    cancel_url: `${appUrl()}/${organization.slug}/settings/billing?checkout=cancelled`,
    allow_promotion_codes: true,
  })

  if (!session.url) throw appError('INTERNAL_ERROR', 'Stripe did not return a checkout URL')

  redirect(session.url)
}

export async function openBillingPortal() {
  const auth = await requireAuth()
  if (!ORG_ADMIN_ROLES.includes(auth.orgRole)) {
    throw appError('FORBIDDEN', 'Billing is restricted to owners and admins')
  }

  const supabase = createClient()
  const { data: organization } = await supabase
    .from('organizations')
    .select('slug, stripe_customer_id')
    .eq('id', auth.orgId)
    .single()

  if (!organization) throw appError('NOT_FOUND', 'Organization not found')

  if (!organization.stripe_customer_id) {
    throw appError('SUBSCRIPTION_REQUIRED', 'No billing account yet')
  }

  const stripe = getStripe()
  const session = await stripe.billingPortal.sessions.create({
    customer: organization.stripe_customer_id,
    return_url: `${appUrl()}/${organization.slug}/settings/billing`,
  })

  redirect(session.url)
}
