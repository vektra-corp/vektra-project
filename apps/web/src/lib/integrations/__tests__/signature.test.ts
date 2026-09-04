import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signWebhook } from '../signature'

describe('signWebhook', () => {
  const secret = 'whsec_test'
  const body = '{"event":"task.created"}'

  it('produces a hex sha256 HMAC', () => {
    expect(signWebhook(secret, '1700000000', body)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches the documented construction, which receivers reimplement', () => {
    // This IS the published contract. If this expectation needs changing, every
    // customer's verification code breaks with it.
    const expected = createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex')
    expect(signWebhook(secret, '1700000000', body)).toBe(expected)
  })

  it('changes when the timestamp changes, so a capture cannot be replayed', () => {
    expect(signWebhook(secret, '1700000000', body)).not.toBe(
      signWebhook(secret, '1700000001', body),
    )
  })

  it('changes when the body changes', () => {
    expect(signWebhook(secret, '1700000000', body)).not.toBe(
      signWebhook(secret, '1700000000', '{"event":"task.deleted"}'),
    )
  })

  it('changes when the secret changes', () => {
    expect(signWebhook(secret, '1700000000', body)).not.toBe(
      signWebhook('other', '1700000000', body),
    )
  })

  it('refuses a timestamp that is not whole seconds', () => {
    // `{timestamp}.{body}` is ambiguous if the timestamp may contain a dot:
    // ("1", "23.body") and ("1.23", "body") would sign identically. Rejecting a
    // non-numeric timestamp makes that unreachable by construction rather than
    // by the caller happening to pass whole seconds.
    expect(() => signWebhook(secret, '1.23', body)).toThrow(/digits/)
    expect(() => signWebhook(secret, '', body)).toThrow()
    expect(() => signWebhook(secret, 'now', body)).toThrow()
  })

  it('is stable across calls', () => {
    expect(signWebhook(secret, '1700000000', body)).toBe(signWebhook(secret, '1700000000', body))
  })
})
