'use client'

import { Badge, Button, Input, Textarea, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { shortMoney } from '@/components/chart-format'
import { changePlan, clearPendingChange, endGrant, provisionGrant, setCancelAtPeriodEnd } from './actions'

export interface PriceOption {
  id: string
  planId: string
  planName: string
  sort: number
  currency: string
  interval: 'monthly' | 'annual'
  unitAmountMinor: number
  tenantSpecific: boolean
}

export interface PaidSummary {
  id: string
  planName: string
  status: string
  provider: string
  currency: string
  interval: string
  unitAmountMinor: number
  seats: number
  periodEnd: string | null
  cancelAtPeriodEnd: boolean
  needsReauthorization: boolean
  pendingPlanName: string | null
  pendingReason: string | null
  pendingSynced: boolean
}

export interface GrantSummary {
  id: string
  planName: string
  kind: string
  endsAt: string | null
  reason: string | null
}

/**
 * Subscription operations for one tenant.
 *
 * The three ways a plan can move are presented as three distinct choices rather
 * than one dropdown, because they are genuinely different promises:
 *
 *   Next renewal  — nothing changes today. The safe default, and so it is the
 *                   preselected one.
 *   Immediately   — entitlement changes now; the gateway mandate still debits
 *                   the old figure until the sync job pushes it. Said plainly
 *                   on the control, because an operator who assumes otherwise
 *                   will tell a customer something untrue.
 *   Without payment — not a plan change at all but a grant: a separate row with
 *                   a mandatory end date, which outranks whatever they pay for.
 */
export function SubscriptionControls({
  orgId,
  orgCurrency,
  readOnly,
  paid,
  grant,
  prices,
  plans,
}: {
  orgId: string
  orgCurrency: string
  readOnly: boolean
  paid: PaidSummary | null
  grant: GrantSummary | null
  prices: PriceOption[]
  /** Every plan this tenant may be GRANTED. Independent of whether it has a price. */
  plans: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [interval, setInterval] = useState<'monthly' | 'annual'>(
    (paid?.interval as 'monthly' | 'annual') ?? 'monthly',
  )
  const [priceId, setPriceId] = useState('')
  const [when, setWhen] = useState<'next_cycle' | 'immediate'>('next_cycle')
  const [reason, setReason] = useState('')

  const [grantPlanId, setGrantPlanId] = useState('')
  const [grantKind, setGrantKind] = useState<'comp' | 'early_access'>('comp')
  const [grantEnds, setGrantEnds] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [grantInterval, setGrantInterval] = useState<'monthly' | 'annual'>('monthly')

  // Prefer prices in the currency this subscription is actually billed in; an
  // immediate change across currencies is refused server-side anyway.
  const billingCurrency = paid?.currency ?? orgCurrency
  const options = useMemo(
    () =>
      prices
        .filter((p) => p.interval === interval)
        .sort(
          (a, b) =>
            Number(a.currency !== billingCurrency) - Number(b.currency !== billingCurrency) ||
            a.sort - b.sort ||
            a.unitAmountMinor - b.unitAmountMinor,
        ),
    [prices, interval, billingCurrency],
  )

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn()
      if (result.ok) {
        toast({ title: success })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Failed', description: result.message })
      }
    })
  }

  const fd = (entries: Record<string, string>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(entries)) f.set(k, v)
    return f
  }

  const selectCls =
    'h-9 w-full rounded-md border border-input bg-surface-raised px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-medium">Subscription</h2>
        {paid ? (
          <span className="text-muted-foreground text-xs">
            {paid.planName} · {paid.provider} · {paid.status}
          </span>
        ) : (
          <span className="text-faint text-xs">No paid subscription</span>
        )}
      </div>

      {/* ---- Current state ---- */}
      {paid ? (
        <div className="space-y-2 rounded-md border border-border-subtle bg-surface-raised p-3">
          <p className="text-xs">
            <span className="text-muted-foreground">Charged </span>
            <span className="tabular-nums">
              {shortMoney(paid.unitAmountMinor, paid.currency)} / seat /{' '}
              {paid.interval === 'annual' ? 'year' : 'month'} × {paid.seats}
            </span>
          </p>
          {paid.periodEnd ? (
            <p className="text-muted-foreground text-xs">
              Renews {new Date(paid.periodEnd).toISOString().slice(0, 10)}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {paid.cancelAtPeriodEnd ? <Badge variant="warning" shape="meta">Cancels at period end</Badge> : null}
            {paid.needsReauthorization ? (
              <Badge variant="destructive" shape="meta">Needs re-authorization</Badge>
            ) : null}
            {paid.pendingPlanName ? (
              <Badge variant="outline" shape="meta">
                Queued → {paid.pendingPlanName}
                {paid.pendingSynced ? ' (synced)' : ' (not yet pushed)'}
              </Badge>
            ) : null}
          </div>

          {paid.pendingPlanName ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <p className="text-muted-foreground flex-1 text-xs">
                {paid.pendingReason ?? 'Change queued for the next renewal.'}
              </p>
              {!paid.pendingSynced ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={readOnly || pending}
                  onClick={() =>
                    run(
                      () => clearPendingChange(fd({ org_id: orgId, subscription_id: paid.id })),
                      'Queued change cleared.',
                    )
                  }
                >
                  Clear
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="pt-1">
            <Button
              size="xs"
              variant={paid.cancelAtPeriodEnd ? 'outline' : 'ghost'}
              disabled={readOnly || pending}
              onClick={() =>
                run(
                  () =>
                    setCancelAtPeriodEnd(
                      fd({
                        org_id: orgId,
                        subscription_id: paid.id,
                        cancel: String(!paid.cancelAtPeriodEnd),
                      }),
                    ),
                  paid.cancelAtPeriodEnd ? 'Cancellation revoked.' : 'Will cancel at period end.',
                )
              }
            >
              {paid.cancelAtPeriodEnd ? 'Keep subscription' : 'Cancel at period end'}
            </Button>
          </div>
        </div>
      ) : null}

      {grant ? (
        <div className="border-primary/30 bg-primary/5 space-y-1 rounded-md border p-3">
          <p className="text-xs">
            <span className="text-muted-foreground">Granted </span>
            {grant.planName} · {grant.kind}
            {grant.endsAt ? ` until ${new Date(grant.endsAt).toISOString().slice(0, 10)}` : ''}
          </p>
          <p className="text-muted-foreground text-xs">{grant.reason ?? 'No reason recorded.'}</p>
          <p className="text-faint text-xs">
            A grant outranks a paid subscription while it lasts.
          </p>
          <Button
            size="xs"
            variant="outline"
            className="mt-1"
            disabled={readOnly || pending}
            onClick={() =>
              run(() => endGrant(fd({ org_id: orgId, subscription_id: grant.id })), 'Grant ended.')
            }
          >
            End grant now
          </Button>
        </div>
      ) : null}

      {readOnly ? (
        <p className="text-faint text-xs">Your role is read-only.</p>
      ) : (
        <>
          {/* ---- Change plan ---- */}
          <div className="space-y-2.5 border-t border-border-subtle pt-4">
            <p className="label-meta text-faint">Change plan</p>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-muted-foreground block text-xs">Billing interval</span>
                <select
                  className={selectCls}
                  value={interval}
                  onChange={(e) => {
                    setInterval(e.target.value as 'monthly' | 'annual')
                    setPriceId('')
                  }}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-muted-foreground block text-xs">Plan</span>
                <select className={selectCls} value={priceId} onChange={(e) => setPriceId(e.target.value)}>
                  <option value="">Choose…</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.planName} — {shortMoney(p.unitAmountMinor, p.currency)}/seat
                      {p.tenantSpecific ? ' (custom)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {options.length === 0 ? (
              <p className="text-faint text-xs">
                No active {interval} prices in the catalogue. Add one on the Pricing page.
              </p>
            ) : null}

            <fieldset className="space-y-1.5">
              <legend className="text-muted-foreground pb-1 text-xs">When</legend>
              {(
                [
                  ['next_cycle', 'At next renewal', 'Nothing changes today. The gateway is told to charge the new amount from the next cycle.'],
                  ['immediate', 'Immediately', 'Entitlement changes now. The mandate keeps debiting the old amount until the sync job pushes it.'],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="when"
                    value={value}
                    checked={when === value}
                    onChange={() => setWhen(value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-xs">{label}</span>
                    <span className="text-faint block text-xs">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <Input
              placeholder="Reason (recorded in both audit trails)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />

            <Button
              size="sm"
              loading={pending}
              disabled={!priceId || !paid}
              onClick={() =>
                run(
                  () => changePlan(fd({ org_id: orgId, price_id: priceId, when, reason })),
                  when === 'immediate' ? 'Plan changed.' : 'Change queued for next renewal.',
                )
              }
            >
              Apply change
            </Button>
            {!paid ? (
              <p className="text-faint text-xs">
                No paid subscription to move — use “Provision without payment” below.
              </p>
            ) : null}
          </div>

          {/* ---- Provision without payment ---- */}
          <div className="space-y-2.5 border-t border-border-subtle pt-4">
            <p className="label-meta text-faint">Provision without payment</p>
            <p className="text-faint text-xs">
              Grants a plan at no charge. Replaces any existing grant, and must have an end date —
              a grant that never ends is a plan change, not a grant.
            </p>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-muted-foreground block text-xs">Plan</span>
                <select className={selectCls} value={grantPlanId} onChange={(e) => setGrantPlanId(e.target.value)}>
                  <option value="">Choose…</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-muted-foreground block text-xs">Type</span>
                <select
                  className={selectCls}
                  value={grantKind}
                  onChange={(e) => setGrantKind(e.target.value as 'comp' | 'early_access')}
                >
                  <option value="comp">Comped</option>
                  <option value="early_access">Early access</option>
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-muted-foreground block text-xs">Interval</span>
                <select
                  className={selectCls}
                  value={grantInterval}
                  onChange={(e) => setGrantInterval(e.target.value as 'monthly' | 'annual')}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-muted-foreground block text-xs">Ends on</span>
                <Input type="date" value={grantEnds} onChange={(e) => setGrantEnds(e.target.value)} />
              </label>
            </div>

            <Textarea
              rows={2}
              placeholder="Why is this being granted?"
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
            />

            <Button
              size="sm"
              variant="outline"
              loading={pending}
              disabled={!grantPlanId || !grantEnds}
              onClick={() =>
                run(
                  () =>
                    provisionGrant(
                      fd({
                        org_id: orgId,
                        plan_id: grantPlanId,
                        grant_kind: grantKind,
                        grant_ends_at: grantEnds,
                        billing_interval: grantInterval,
                        reason: grantReason,
                      }),
                    ),
                  'Plan granted.',
                )
              }
            >
              Grant plan
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
