import { describe, expect, it } from 'vitest'
import {
  GST_STATE_CODES,
  gstStateName,
  isBillingCountry,
  isGstStateCode,
} from '../constants/billing-geography'
import { billingProfileSchema } from '../validators/organization'

/**
 * The billing profile decides the gateway, the currency and the tax regime, so
 * every rule here changes what a customer is charged rather than how a form
 * looks. The cross-field cases are the ones worth pinning: each is an input
 * that would otherwise produce a lawful-looking invoice with the wrong tax on it.
 */

const VALID_GSTIN_KA = '29ABCDE1234F1Z5' // 29 = Karnataka

describe('billingProfileSchema', () => {
  it('accepts an Indian profile whose GSTIN agrees with its state', () => {
    const result = billingProfileSchema.safeParse({
      billing_country: 'IN',
      billing_state: '29',
      gstin: VALID_GSTIN_KA,
    })
    expect(result.success).toBe(true)
  })

  it('accepts an Indian profile with no GSTIN', () => {
    const result = billingProfileSchema.safeParse({
      billing_country: 'IN',
      billing_state: '29',
      gstin: '',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.gstin).toBeNull()
  })

  it('requires a state for India', () => {
    // Without one, placeOfSupply() falls back to the SELLER's state and every
    // invoice silently becomes intra-state.
    const result = billingProfileSchema.safeParse({ billing_country: 'IN' })
    expect(result.success).toBe(false)
  })

  it('rejects a GSTIN whose state disagrees with the selected state', () => {
    // This is the exact input that flips CGST+SGST into IGST.
    const result = billingProfileSchema.safeParse({
      billing_country: 'IN',
      billing_state: '33', // Tamil Nadu
      gstin: VALID_GSTIN_KA, // Karnataka
    })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed GSTIN', () => {
    const result = billingProfileSchema.safeParse({
      billing_country: 'IN',
      billing_state: '29',
      gstin: '29ABCDE1234F1Z', // one character short
    })
    expect(result.success).toBe(false)
  })

  it('rejects a GSTIN outside India rather than ignoring it', () => {
    const result = billingProfileSchema.safeParse({
      billing_country: 'US',
      gstin: VALID_GSTIN_KA,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a GST state outside India', () => {
    const result = billingProfileSchema.safeParse({
      billing_country: 'US',
      billing_state: '29',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a state code that is not a real GST code', () => {
    const result = billingProfileSchema.safeParse({
      billing_country: 'IN',
      billing_state: '99',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a country outside the offered list', () => {
    const result = billingProfileSchema.safeParse({ billing_country: 'ZZ' })
    expect(result.success).toBe(false)
  })

  it('normalises a lowercase GSTIN', () => {
    const result = billingProfileSchema.safeParse({
      billing_country: 'IN',
      billing_state: '29',
      gstin: VALID_GSTIN_KA.toLowerCase(),
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.gstin).toBe(VALID_GSTIN_KA)
  })
})

describe('billing geography', () => {
  it('recognises India as a billing country', () => {
    expect(isBillingCountry('IN')).toBe(true)
    expect(isBillingCountry('ZZ')).toBe(false)
  })

  it('maps GST codes to state names', () => {
    expect(gstStateName('29')).toBe('Karnataka')
    expect(gstStateName('33')).toBe('Tamil Nadu')
    expect(gstStateName('99')).toBeNull()
  })

  it('has no duplicate GST state codes', () => {
    const codes = GST_STATE_CODES.map((state) => state.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('validates every listed state code as a GST code', () => {
    expect(isGstStateCode('01')).toBe(true)
    expect(isGstStateCode('38')).toBe(true)
    expect(isGstStateCode('00')).toBe(false)
  })
})
