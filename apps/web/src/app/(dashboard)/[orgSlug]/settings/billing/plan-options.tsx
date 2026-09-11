'use client'

import { formatCurrency } from '@pm/shared/utils'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { startCheckout } from './actions'

/**
 * Plan selection and Razorpay Checkout.
 *
 * The only thing this component decides is WHICH plan to ask for. Price, seat
 * count and tax are all computed in the server action — a client that could
 * name its own amount would be a way to buy Enterprise for one rupee.
 *
 * Checkout's handler callback is treated as a UX signal and nothing more. It
 * tells us the customer got through the sheet, so we can show a pending state
 * and refresh; entitlement is granted by the webhook, from Razorpay's own
 * servers, because anything the browser reports is attacker-controlled.
 */

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

interface RazorpayInstance {
  open: () => void
  on: (event: string, handler: (payload: unknown) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

/** Load Checkout once, and resolve immediately if it is already present. */
function loadCheckoutScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('No window'))
    if (window.Razorpay) return resolve()

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Checkout failed to load')))
      return
    }

    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT
    script.async = true
    script.onload = () => resolve()
    // Almost always a blocked request rather than a network failure — a CSP
    // without checkout.razorpay.com in script-src fails exactly here, silently.
    script.onerror = () => reject(new Error('Checkout failed to load'))
    document.body.appendChild(script)
  })
}

export interface PlanOption {
  planId: string
  tier: string
  displayName: string
  /** Tax-exclusive, per seat, in minor units. */
  unitAmountMinor: number
  currency: string
}

export function PlanOptions({
  orgSlug,
  plans,
  currentTier,
  seats,
  locale,
  canManage,
}: {
  orgSlug: string
  plans: PlanOption[]
  currentTier: string
  seats: number
  locale: string
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)

  async function choose(plan: PlanOption) {
    setBusyPlanId(plan.planId)
    try {
      const result = await startCheckout(orgSlug, { planId: plan.planId, interval: 'monthly' })

      if (!result.ok) {
        toast({ title: 'Could not start checkout', description: result.message, variant: 'destructive' })
        return
      }

      await loadCheckoutScript()
      if (!window.Razorpay) throw new Error('Checkout failed to load')

      const checkout = new window.Razorpay({
        key: result.data.keyId,
        subscription_id: result.data.providerSubscriptionId,
        name: 'Vektra Projects',
        description: `${plan.displayName} — ${result.data.seats} ${result.data.seats === 1 ? 'seat' : 'seats'}`,
        theme: { color: '#111827' },
        handler: () => {
          // The mandate is registered. The subscription is still 'pending' here
          // and becomes active when the webhook arrives, which is usually
          // seconds but is not guaranteed to be before this refresh lands.
          toast({
            title: 'Payment received',
            description: 'Your plan updates as soon as Razorpay confirms the charge.',
          })
          startTransition(() => router.refresh())
        },
        modal: {
          ondismiss: () => {
            // Abandoned. The pending subscription row stays until it expires,
            // which is what stops a second checkout racing the first.
            toast({ title: 'Checkout cancelled' })
            startTransition(() => router.refresh())
          },
        },
      })

      checkout.on('payment.failed', () => {
        toast({
          title: 'Payment failed',
          description: 'Your bank declined the mandate. Nothing has been charged.',
          variant: 'destructive',
        })
      })

      checkout.open()
    } catch (error) {
      toast({
        title: 'Could not start checkout',
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      })
    } finally {
      setBusyPlanId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Change plan</CardTitle>
        <CardDescription>
          Billed per seat, per month. You have {seats} {seats === 1 ? 'seat' : 'seats'}; tax is
          added at checkout.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.tier === currentTier
            return (
              <div key={plan.planId} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{plan.displayName}</p>
                  {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                </div>
                <p className="mt-1 text-ui tabular-nums">
                  {formatCurrency(plan.unitAmountMinor / 100, plan.currency, locale)}
                  <span className="text-muted-foreground"> / seat / month</span>
                </p>
                <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                  {formatCurrency((plan.unitAmountMinor * seats) / 100, plan.currency, locale)} for{' '}
                  {seats} {seats === 1 ? 'seat' : 'seats'}, before tax
                </p>
                <Button
                  className="mt-3 w-full"
                  variant={isCurrent ? 'outline' : 'default'}
                  disabled={!canManage || isCurrent || pending || busyPlanId !== null}
                  onClick={() => void choose(plan)}
                >
                  {busyPlanId === plan.planId ? 'Opening…' : isCurrent ? 'Current plan' : 'Choose'}
                </Button>
              </div>
            )
          })}
        </div>
        {!canManage ? (
          <p className="text-muted-foreground mt-3 text-xs">
            Only owners and admins can change the plan.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
