/**
 * Geography that changes what a customer is charged.
 *
 * Two lists, both load-bearing rather than cosmetic:
 *
 *  - The country decides the gateway (IN -> Razorpay) and the tax regime
 *    (domestic GST versus zero-rated export), so it is not a display preference.
 *  - The Indian state code decides CGST+SGST versus IGST. It is the first two
 *    digits of a GSTIN, and the two must agree — the organizations table
 *    enforces that as a CHECK.
 */

/** GST state codes, as published by the GST Council. The value IS the code. */
export const GST_STATE_CODES = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
] as const

export type GstStateCode = (typeof GST_STATE_CODES)[number]['code']

export function isGstStateCode(value: unknown): value is GstStateCode {
  return (
    typeof value === 'string' && GST_STATE_CODES.some((state) => state.code === value)
  )
}

export function gstStateName(code: string | null | undefined): string | null {
  return GST_STATE_CODES.find((state) => state.code === code)?.name ?? null
}

/**
 * GSTIN shape, matching the CHECK on organizations.gstin exactly.
 *
 * Two state digits, a five-letter PAN prefix, four PAN digits, a PAN check
 * letter, an entity digit, a literal Z, and a checksum character.
 */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/

/**
 * Billing countries offered at signup.
 *
 * Deliberately a curated list rather than all 249 ISO entries: every entry here
 * is a market we can actually invoice, and an unfamiliar country is better
 * handled by a support conversation than by silently issuing an export invoice
 * we cannot substantiate. India is first because it is the primary market.
 */
export const BILLING_COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'AU', name: 'Australia' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'DE', name: 'Germany' },
  { code: 'DK', name: 'Denmark' },
  { code: 'ES', name: 'Spain' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NP', name: 'Nepal' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SE', name: 'Sweden' },
  { code: 'SG', name: 'Singapore' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'US', name: 'United States' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'ZA', name: 'South Africa' },
] as const

export type BillingCountryCode = (typeof BILLING_COUNTRIES)[number]['code']

export function isBillingCountry(value: unknown): value is BillingCountryCode {
  return typeof value === 'string' && BILLING_COUNTRIES.some((c) => c.code === value)
}

export function billingCountryName(code: string | null | undefined): string | null {
  return BILLING_COUNTRIES.find((c) => c.code === code)?.name ?? null
}
