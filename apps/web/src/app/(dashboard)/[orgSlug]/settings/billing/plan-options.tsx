'use client'

import { formatCurrency } from '@pm/shared/utils'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { openRazorpayCheckout } from '@/lib/payments/checkout-client'
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
 *
 * The handoff itself lives in `lib/payments/checkout-client` and is shared with
 * the sidebar upgrade dialog — two copies would drift, and the half that drifts
 * is the half that decides whether a customer thinks they paid.
 */

export interface PlanOption {
  planId: string
  tier: string
  displayName: string
  sortOrder: number
  currency: string
  /** TAX-INCLUSIVE per-seat price, in minor units. Null when not sold on that interval. */
  monthlyMinor: number | null
  annualMinor: number | null
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

  // Default to whichever interval the catalogue actually offers. Starting on
  // monthly when nothing is sold monthly showed an empty card.
  const [interval, setInterval] = useState<'monthly' | 'annual'>(() =>
    plans.some((p) => p.monthlyMinor !== null) ? 'monthly' : 'annual',
  )

  const priceOf = (plan: PlanOption) =>
    interval === 'monthly' ? plan.monthlyMinor : plan.annualMinor

  const money = (minor: number, currency: string) =>
    formatCurrency(minor / 100, currency, locale)

  async function choose(plan: PlanOption) {
    setBusyPlanId(plan.planId)
    try {
      const result = await startCheckout(orgSlug, { planId: plan.planId, interval })

      if (!result.ok) {
        toast({ title: 'Could not start checkout', description: result.message, variant: 'destructive' })
        return
      }

      await openRazorpayCheckout(result.data, {
        description: `${plan.displayName} (${interval}) — ${result.data.seats} ${result.data.seats === 1 ? 'seat' : 'seats'}`,
        onPaid: () => {
          // The mandate is registered. The subscription is still 'pending' here
          // and becomes active when the webhook arrives, which is usually
          // seconds but is not guaranteed to be before this refresh lands.
          toast({
            title: 'Payment received',
            description: 'Your plan updates as soon as Razorpay confirms the charge.',
          })
          startTransition(() => router.refresh())
        },
        onDismiss: () => {
          // Abandoned. The pending subscription row stays until it expires,
          // which is what stops a second checkout racing the first.
          toast({ title: 'Checkout cancelled' })
          startTransition(() => router.refresh())
        },
        onFailed: () => {
          toast({
            title: 'Payment failed',
            description: 'Your bank declined the mandate. Nothing has been charged.',
            variant: 'destructive',
          })
        },
      })
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

  const hasMonthly = plans.some((p) => p.monthlyMinor !== null)
  const hasAnnual = plans.some((p) => p.annualMinor !== null)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Change plan</CardTitle>
            <CardDescription>
              Per seat, {interval === 'annual' ? 'billed yearly' : 'billed monthly'}. You have{' '}
              {seats} {seats === 1 ? 'seat' : 'seats'}; prices include GST.
            </CardDescription>
          </div>

          {hasMonthly && hasAnnual ? (
            <div
              role="group"
              aria-label="Billing interval"
              className="border-border bg-surface flex shrink-0 rounded-md border p-0.5"
            >
              {(['monthly', 'annual'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={interval === value}
                  onClick={() => setInterval(value)}
                  className={`rounded px-3 py-1 text-xs capitalize transition-colors ${
                    interval === value
                      ? 'bg-surface-hover text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {plans.length === 0 ? (
          <p className="text-muted-foreground text-ui">
            No plans are currently available for purchase in {plans[0]?.currency ?? 'your currency'}
            . Contact support and we will sort it out.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = plan.tier === currentTier
              const priceMinor = priceOf(plan)
              const unavailable = priceMinor === null

              // What twelve months at the monthly rate would cost, so an annual
              // price states its own saving rather than leaving the arithmetic
              // to the customer.
              const baseline = plan.monthlyMinor !== null ? plan.monthlyMinor * 12 : null
              const savingPct =
                interval === 'annual' && baseline && priceMinor !== null && baseline > 0
                  ? Math.round(((baseline - priceMinor) / baseline) * 100)
                  : null

              return (
                <div key={plan.planId} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{plan.displayName}</p>
                    {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                  </div>

                  {unavailable ? (
                    <p className="text-muted-foreground mt-1 text-ui">
                      Not sold {interval === 'annual' ? 'annually' : 'monthly'}
                    </p>
                  ) : (
                    <>
                      <p className="mt-1 text-ui tabular-nums">
                        {money(priceMinor, plan.currency)}
                        <span className="text-muted-foreground">
                          {' '}
                          / seat / {interval === 'annual' ? 'year' : 'month'}
                        </span>
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                        {money(priceMinor * seats, plan.currency)} for {seats}{' '}
                        {seats === 1 ? 'seat' : 'seats'}, GST included
                      </p>
                      {savingPct && savingPct > 0 ? (
                        <p className="text-success mt-1 text-xs tabular-nums">
                          Save {savingPct}% vs monthly
                        </p>
                      ) : null}
                    </>
                  )}

                  <Button
                    className="mt-3 w-full"
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={
                      !canManage || isCurrent || unavailable || pending || busyPlanId !== null
                    }
                    onClick={() => void choose(plan)}
                  >
                    {busyPlanId === plan.planId
                      ? 'Opening…'
                      : isCurrent
                        ? 'Current plan'
                        : unavailable
                          ? 'Unavailable'
                          : 'Choose'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}

        {!canManage ? (
          <p className="text-muted-foreground mt-3 text-xs">
            Only owners and admins can change the plan.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
