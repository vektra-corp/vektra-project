import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PaymentConfigError, razorpayConfigured, razorpayIsTestMode } from '../config'
import { verifyCheckoutSignature, verifyWebhookSignature } from '../razorpay'

/**
 * Signature verification is the whole security boundary of the payment path.
 *
 * Everything else in the webhook route is bookkeeping; if this function is
 * wrong, anyone who can find the URL can grant themselves an Enterprise plan by
 * POSTing a JSON body. These tests exist to pin the two details that are easy
 * to get subtly wrong and impossible to notice in a happy-path manual test:
 * which secret signs which payload, and the field order inside the digest.
 */

const KEY_ID = 'rzp_test_ExampleKeyId'
const KEY_SECRET = 'example_key_secret_value'
const WEBHOOK_SECRET = 'example_webhook_secret'

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = KEY_ID
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET
})

afterEach(() => {
  delete process.env.RAZORPAY_KEY_ID
  delete process.env.RAZORPAY_KEY_SECRET
  delete process.env.RAZORPAY_WEBHOOK_SECRET
})

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('hex')

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({
    event: 'subscription.charged',
    payload: { subscription: { entity: { id: 'sub_test123' } } },
  })

  it('accepts a signature computed over the raw body with the webhook secret', () => {
    expect(verifyWebhookSignature(body, sign(body, WEBHOOK_SECRET))).toBe(true)
  })

  it('rejects a body modified after signing', () => {
    const signature = sign(body, WEBHOOK_SECRET)
    const tampered = body.replace('sub_test123', 'sub_attacker')
    expect(verifyWebhookSignature(tampered, signature)).toBe(false)
  })

  it('rejects a signature made with the key secret instead of the webhook secret', () => {
    // The two secrets are interchangeable by eye and not by function. Using the
    // wrong one is the most likely misconfiguration, so it must fail closed.
    expect(verifyWebhookSignature(body, sign(body, KEY_SECRET))).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyWebhookSignature(body, null)).toBe(false)
  })

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on unequal buffer lengths; the length guard is
    // what turns a truncated header into `false` rather than a 500.
    expect(verifyWebhookSignature(body, 'abc123')).toBe(false)
  })

  it('is sensitive to re-serialisation', () => {
    // Parsing and re-stringifying reorders keys and drops whitespace. This is
    // why the route digests the raw text and never the parsed object.
    const signature = sign(body, WEBHOOK_SECRET)
    const reserialised = JSON.stringify(JSON.parse(body), Object.keys(JSON.parse(body)).reverse())
    expect(verifyWebhookSignature(reserialised, signature)).toBe(false)
  })

  it('throws when the webhook secret is absent rather than passing', () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    expect(() => verifyWebhookSignature(body, sign(body, WEBHOOK_SECRET))).toThrow(
      PaymentConfigError,
    )
  })
})

describe('verifyCheckoutSignature', () => {
  const paymentId = 'pay_test456'
  const subscriptionId = 'sub_test123'

  it('accepts payment_id|subscription_id signed with the key secret', () => {
    const signature = sign(`${paymentId}|${subscriptionId}`, KEY_SECRET)
    expect(verifyCheckoutSignature({ paymentId, subscriptionId, signature })).toBe(true)
  })

  it('rejects the order used for one-off orders', () => {
    // Orders sign `order_id|payment_id`; subscriptions reverse it. Getting this
    // backwards yields a well-formed HMAC that never matches, which is
    // indistinguishable from "customer's payment failed" unless pinned here.
    const signature = sign(`${subscriptionId}|${paymentId}`, KEY_SECRET)
    expect(verifyCheckoutSignature({ paymentId, subscriptionId, signature })).toBe(false)
  })

  it('rejects a signature made with the webhook secret', () => {
    const signature = sign(`${paymentId}|${subscriptionId}`, WEBHOOK_SECRET)
    expect(verifyCheckoutSignature({ paymentId, subscriptionId, signature })).toBe(false)
  })

  it('rejects a payment id swapped after signing', () => {
    const signature = sign(`${paymentId}|${subscriptionId}`, KEY_SECRET)
    expect(
      verifyCheckoutSignature({ paymentId: 'pay_other', subscriptionId, signature }),
    ).toBe(false)
  })
})

describe('configuration reporting', () => {
  it('reports configured only when all three values are present', () => {
    expect(razorpayConfigured()).toBe(true)
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    expect(razorpayConfigured()).toBe(false)
  })

  it('treats a blank value as absent', () => {
    process.env.RAZORPAY_KEY_SECRET = '   '
    expect(razorpayConfigured()).toBe(false)
  })

  it('detects test mode from the key id prefix', () => {
    expect(razorpayIsTestMode()).toBe(true)
    process.env.RAZORPAY_KEY_ID = 'rzp_live_Something'
    expect(razorpayIsTestMode()).toBe(false)
  })

  it('names every missing variable rather than only the first', () => {
    delete process.env.RAZORPAY_KEY_ID
    delete process.env.RAZORPAY_KEY_SECRET
    try {
      verifyCheckoutSignature({ paymentId: 'p', subscriptionId: 's', signature: 'x' })
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('RAZORPAY_KEY_ID')
      expect((error as Error).message).toContain('RAZORPAY_KEY_SECRET')
    }
  })
})
