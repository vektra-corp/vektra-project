import { describe, expect, it } from 'vitest'
import { isUndeliverable } from '../address'

describe('isUndeliverable', () => {
  it('refuses reserved TLDs that can never resolve', () => {
    // A provider accepts these and hard-bounces later, so the app records a
    // successful send while the sending domain's reputation degrades.
    for (const address of [
      'member@acme.test',
      'someone@corp.invalid',
      'a@b.example',
      'dev@app.localhost',
    ]) {
      expect(isUndeliverable(address), address).toBe(true)
    }
  })

  it('refuses the documentation domains', () => {
    expect(isUndeliverable('a@example.com')).toBe(true)
    expect(isUndeliverable('a@example.net')).toBe(true)
    expect(isUndeliverable('a@mail.example.org')).toBe(true)
  })

  it('allows a real address', () => {
    for (const address of [
      'someone@vektracorp.in',
      'first.last@gmail.com',
      'ops@sub.company.co.uk',
      // A domain that merely contains "test" is fine.
      'a@testing.com',
      'a@contest.org',
    ]) {
      expect(isUndeliverable(address), address).toBe(false)
    }
  })

  it('refuses anything that is not an address at all', () => {
    expect(isUndeliverable('')).toBe(true)
    expect(isUndeliverable('no-at-sign')).toBe(true)
    expect(isUndeliverable('a@localhost')).toBe(true)
  })

  it('is case and whitespace insensitive', () => {
    expect(isUndeliverable('  Member@ACME.TEST  ')).toBe(true)
  })
})
