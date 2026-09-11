import 'server-only'

import { providerForCountry, type PaymentProvider } from '@pm/shared/billing'

/**
 * Which gateway serves a checkout, and the seller identity that prices it.
 *
 * `providerForCountry` in @pm/shared is the pure rule. This module is the
 * server-side wrapper that adds the one thing a pure function must not have: a
 * development override, and a hard refusal to honour it in production.
 */

/** True when this deployment is production, by either runtime's reckoning. */
function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
}

/**
 * Resolve the gateway for an organization's billing country.
 *
 * `PAYMENTS_PROVIDER_OVERRIDE` exists so one machine can exercise both paths
 * without editing a tenant's country — and is ignored outright in production,
 * where honouring it would mean routing a real Indian customer to PayPal and
 * issuing them a zero-rated export invoice for a domestic supply.
 */
export function selectProvider(billingCountry: string | null | undefined): PaymentProvider {
  const override = (process.env.PAYMENTS_PROVIDER_OVERRIDE ?? '').trim()
  if (override && !isProduction()) {
    if (override === 'razorpay' || override === 'paypal') return override
  }
  return providerForCountry(billingCountry)
}

export interface SellerProfile {
  legalName: string
  parentEntity: string | null
  gstin: string | null
  /** Two-digit GST state code. Place of supply for an intra-state supply. */
  state: string
  address: string | null
  sacCode: string
  /** Letter of Undertaking reference. Its absence makes an export IGST-bearing. */
  lutArn: string | null
}

const read = (name: string): string => (process.env[name] ?? '').trim()

/**
 * The selling entity, from configuration.
 *
 * The state code is the one field with no safe default: guessing it would flip
 * CGST+SGST into IGST for every domestic customer, so an unset value is an
 * error rather than a fallback (§2, fail closed).
 */
export function sellerProfile(): SellerProfile {
  const state = read('BILLING_SELLER_STATE')
  if (!/^[0-9]{2}$/.test(state)) {
    throw Object.assign(new Error('BILLING_SELLER_STATE must be a two-digit GST state code'), {
      code: 'PAYMENT_NOT_CONFIGURED',
    })
  }

  const gstin = read('BILLING_SELLER_GSTIN') || null
  // The same agreement the organizations table enforces for a buyer. A seller
  // GSTIN disagreeing with the seller state would misstate every invoice.
  if (gstin && gstin.slice(0, 2) !== state) {
    throw Object.assign(
      new Error('BILLING_SELLER_GSTIN does not agree with BILLING_SELLER_STATE'),
      { code: 'PAYMENT_NOT_CONFIGURED' },
    )
  }

  return {
    legalName: read('BILLING_LEGAL_NAME') || 'Vektra Corporation',
    parentEntity: read('BILLING_PARENT_ENTITY') || null,
    gstin,
    state,
    address: read('BILLING_SELLER_ADDRESS') || null,
    sacCode: read('BILLING_SAC_CODE') || '998314',
    lutArn: read('BILLING_LUT_ARN') || null,
  }
}
