import { type PaymentProvider } from './types'

/**
 * Which gateway serves a country.
 *
 * Pure and server-decided. The customer never picks — a tenant who could choose
 * PayPal from India would also be choosing a zero-rated export invoice instead
 * of an 18% GST one, which is why `organizations.billing_country` is not a
 * tenant-writable column (migration 00037).
 */
export function providerForCountry(country: string | null | undefined): PaymentProvider {
  return country?.toUpperCase() === 'IN' ? 'razorpay' : 'paypal'
}

/** The currency a country is billed in. */
export function currencyForCountry(country: string | null | undefined): string {
  return country?.toUpperCase() === 'IN' ? 'INR' : 'USD'
}
