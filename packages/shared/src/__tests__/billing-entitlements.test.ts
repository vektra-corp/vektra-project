import { describe, expect, it } from 'vitest'
import {
  currencyForCountry,
  featureEnabled,
  limitFor,
  providerForCountry,
  resolveEntitlements,
  STARTER_ENTITLEMENTS,
} from '../billing'

describe('providerForCountry', () => {
  it('routes India to Razorpay and everywhere else to PayPal', () => {
    expect(providerForCountry('IN')).toBe('razorpay')
    expect(providerForCountry('US')).toBe('paypal')
    expect(providerForCountry('GB')).toBe('paypal')
  })

  it('tolerates casing', () => {
    expect(providerForCountry('in')).toBe('razorpay')
  })

  it('defaults to PayPal when the country is unknown', () => {
    expect(providerForCountry(null)).toBe('paypal')
    expect(providerForCountry(undefined)).toBe('paypal')
  })

  it('bills India in INR and everyone else in USD', () => {
    expect(currencyForCountry('IN')).toBe('INR')
    expect(currencyForCountry('DE')).toBe('USD')
    expect(currencyForCountry(null)).toBe('USD')
  })
})

describe('resolveEntitlements', () => {
  it('reads a well-formed context row', () => {
    const e = resolveEntitlements({
      plan_name: 'acme-growth-2026',
      plan_tier: 'growth',
      plan_display_name: 'Acme Growth',
      plan_limits: { projects: 250, gantt: true },
      plan_features: { gantt: true, commercial: true },
      entitlement_source: 'paid',
      subscription_status: 'active',
    })
    expect(e.planName).toBe('acme-growth-2026')
    expect(e.planTier).toBe('growth')
    expect(e.source).toBe('paid')
  })

  it('falls back to starter on an unrecognised tier rather than trusting it', () => {
    const e = resolveEntitlements({ plan_tier: 'platinum', plan_features: { gantt: true } })
    expect(e.planTier).toBe('starter')
  })

  it('falls back to starter_default on an unrecognised source', () => {
    expect(resolveEntitlements({ entitlement_source: 'free_for_all' }).source).toBe(
      'starter_default',
    )
  })

  it('survives a completely empty row', () => {
    const e = resolveEntitlements({})
    expect(e.planTier).toBe('starter')
    expect(e.features).toEqual({})
    expect(e.source).toBe('starter_default')
  })

  it('ignores a non-object features blob', () => {
    expect(resolveEntitlements({ plan_features: 'gantt' }).features).toEqual({})
    expect(resolveEntitlements({ plan_features: ['gantt'] }).features).toEqual({})
    expect(resolveEntitlements({ plan_features: null }).features).toEqual({})
  })
})

describe('featureEnabled', () => {
  const growth = resolveEntitlements({
    plan_tier: 'growth',
    plan_features: { gantt: true, commercial: false },
  })

  it('grants a feature the plan marks true', () => {
    expect(featureEnabled(growth, 'gantt')).toBe(true)
  })

  it('denies a feature the plan marks false', () => {
    expect(featureEnabled(growth, 'commercial')).toBe(false)
  })

  it('denies a feature the plan does not mention', () => {
    expect(featureEnabled(growth, 'custom_roles')).toBe(false)
  })

  it('denies on anything that is not literally true', () => {
    // A JSON blob written by an operator could contain any of these; none of
    // them may be read as a grant.
    for (const value of ['true', 1, 'yes', {}, [], null]) {
      const e = resolveEntitlements({ plan_tier: 'growth', plan_features: { gantt: value } })
      expect(featureEnabled(e, 'gantt')).toBe(false)
    }
  })

  it('denies when there are no entitlements at all', () => {
    expect(featureEnabled(null, 'gantt')).toBe(false)
    expect(featureEnabled(undefined, 'gantt')).toBe(false)
  })

  it('grants nothing beyond starter on the default entitlements', () => {
    expect(featureEnabled(STARTER_ENTITLEMENTS, 'gantt')).toBe(false)
    expect(featureEnabled(STARTER_ENTITLEMENTS, 'commercial')).toBe(false)
  })
})

describe('limitFor', () => {
  it('reads a numeric ceiling from the plan', () => {
    const e = resolveEntitlements({ plan_tier: 'growth', plan_limits: { projects: 250 } })
    expect(limitFor(e, 'projects')).toBe(250)
  })

  it('treats an explicit null as unlimited', () => {
    const e = resolveEntitlements({ plan_tier: 'growth', plan_limits: { projects: null } })
    expect(limitFor(e, 'projects')).toBeNull()
  })

  it('falls back to the TIER default for a key the custom plan omits', () => {
    // This is the important one: reading a missing key as unlimited would turn
    // an operator's typo into a free upgrade.
    const e = resolveEntitlements({ plan_tier: 'starter', plan_limits: {} })
    expect(limitFor(e, 'projects')).toBe(10)
  })

  it('falls back to the tier default when the value is not a number', () => {
    const e = resolveEntitlements({ plan_tier: 'starter', plan_limits: { projects: 'lots' } })
    expect(limitFor(e, 'projects')).toBe(10)
  })

  it('falls back to starter when there are no entitlements', () => {
    expect(limitFor(null, 'projects')).toBe(10)
  })

  it('honours a custom plan that raises a tier ceiling', () => {
    const e = resolveEntitlements({ plan_tier: 'starter', plan_limits: { projects: 500 } })
    expect(limitFor(e, 'projects')).toBe(500)
  })
})
