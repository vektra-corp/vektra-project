'use client'

import { formatCurrency } from '@pm/shared/utils'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  toast,
} from '@pm/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import {
  listUpgradeOptions,
  startCheckout,
  type UpgradeOptions,
} from '@/app/(dashboard)/[orgSlug]/settings/billing/actions'
import { openRazorpayCheckout } from '@/lib/payments/checkout-client'

/**
 * Choose a plan and pay, without leaving the page you were on.
 *
 * Opened from the sidebar, which is rendered everywhere, so the options are
 * loaded when the dialog opens rather than on every page render.
 *
 * Two states are refusals rather than failures, and both say why:
 *  - No billing country yet. Checkout would resolve to USD and a gateway we
 *    cannot charge with, so the dialog sends the owner to set it first.
 *  - A member rather than an owner or admin. Billing is an owner/admin action
 *    (§8), and the server action re-checks regardless of what this renders.
 */
export function UpgradeDialog({
  orgSlug,
  open,
  onOpenChange,
  locale,
}: {
  orgSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  locale: string
}) {
  const router = useRouter()
  const [options, setOptions] = useState<UpgradeOptions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!open || options) return
    let cancelled = false

    void listUpgradeOptions(orgSlug).then((result) => {
      if (cancelled) return
      if (result.ok) setOptions(result.data)
      else setLoadError(result.message)
    })

    return () => {
      cancelled = true
    }
  }, [open, options, orgSlug])

  async function choose(planId: string, displayName: string) {
    setBusyPlanId(planId)
    try {
      const result = await startCheckout(orgSlug, { planId, interval: 'monthly' })
      if (!result.ok) {
        toast({
          title: 'Could not start checkout',
          description: result.message,
          variant: 'destructive',
        })
        return
      }

      await openRazorpayCheckout(result.data, {
        description: `${displayName} — ${result.data.seats} ${result.data.seats === 1 ? 'seat' : 'seats'}`,
        onPaid: () => {
          // The mandate is registered. The plan changes when the webhook lands,
          // which is usually seconds away but is not guaranteed to beat this
          // refresh — so the wording promises confirmation, not a plan change.
          toast({
            title: 'Payment received',
            description: 'Your plan updates as soon as Razorpay confirms the charge.',
          })
          onOpenChange(false)
          startTransition(() => router.refresh())
        },
        onDismiss: () => {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a plan</DialogTitle>
          <DialogDescription>
            {options
              ? `Billed per seat, per month. You have ${options.seats} ${options.seats === 1 ? 'seat' : 'seats'}; tax is added at checkout.`
              : 'Loading your options…'}
          </DialogDescription>
        </DialogHeader>

        {loadError ? <p className="text-destructive text-ui">{loadError}</p> : null}

        {options && !options.canManage ? (
          <p className="text-muted-foreground text-ui">
            Only the organization owner or an admin can change the plan. Ask them to upgrade.
          </p>
        ) : null}

        {options && options.canManage && !options.billingReady ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-ui">
              Set your billing country first — it decides your currency, your payment method and
              how your invoices are taxed.
            </p>
            <Button asChild onClick={() => onOpenChange(false)}>
              <Link href={`/${orgSlug}/settings/billing`}>Set billing details</Link>
            </Button>
          </div>
        ) : null}

        {options && options.canManage && options.billingReady ? (
          <div className="space-y-2">
            {options.plans.length === 0 ? (
              <p className="text-muted-foreground text-ui">
                No plans are available for your billing country yet.
              </p>
            ) : (
              options.plans.map((plan) => {
                const isCurrent = plan.tier === options.currentTier
                return (
                  <div
                    key={plan.planId}
                    className="border-border flex items-center justify-between gap-4 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        {plan.displayName}
                        {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                      </p>
                      <p className="text-muted-foreground text-ui tabular-nums">
                        {formatCurrency(plan.unitAmountMinor / 100, plan.currency, locale)} / seat /
                        month
                      </p>
                      <p className="text-faint text-xs tabular-nums">
                        {formatCurrency(
                          (plan.unitAmountMinor * options.seats) / 100,
                          plan.currency,
                          locale,
                        )}{' '}
                        for {options.seats} {options.seats === 1 ? 'seat' : 'seats'}, before tax
                      </p>
                    </div>
                    <Button
                      disabled={isCurrent || busyPlanId !== null}
                      onClick={() => void choose(plan.planId, plan.displayName)}
                    >
                      {busyPlanId === plan.planId ? 'Opening…' : isCurrent ? 'Current' : 'Choose'}
                    </Button>
                  </div>
                )
              })
            )}

            <p className="text-muted-foreground pt-1 text-xs">
              Prices exclude tax.{' '}
              <Link
                className="underline underline-offset-2"
                href={`/${orgSlug}/settings/billing`}
                onClick={() => onOpenChange(false)}
              >
                Full billing settings
              </Link>
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
