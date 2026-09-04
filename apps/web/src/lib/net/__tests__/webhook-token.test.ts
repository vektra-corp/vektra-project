import { describe, expect, it } from 'vitest'
import { hashWebhookToken, hashesMatch, mintWebhookToken } from '../webhook-token'

describe('mintWebhookToken', () => {
  it('returns a URL-safe token and its hash', () => {
    const { token, hash } = mintWebhookToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashWebhookToken(token)).toBe(hash)
  })

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintWebhookToken().token))
    expect(seen.size).toBe(200)
  })

  it('carries enough entropy to be unguessable', () => {
    // 32 random bytes; base64url of that is 43 characters.
    expect(mintWebhookToken().token.length).toBeGreaterThanOrEqual(43)
  })

  it('does not store the plaintext anywhere in the hash', () => {
    const { token, hash } = mintWebhookToken()
    expect(hash).not.toContain(token)
  })
})

describe('hashesMatch', () => {
  it('matches identical hashes', () => {
    const hash = hashWebhookToken('abc')
    expect(hashesMatch(hash, hash)).toBe(true)
  })

  it('rejects different hashes', () => {
    expect(hashesMatch(hashWebhookToken('abc'), hashWebhookToken('abd'))).toBe(false)
  })

  it('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws on unequal lengths; the guard must come first.
    expect(hashesMatch('short', hashWebhookToken('abc'))).toBe(false)
    expect(hashesMatch('', '')).toBe(true)
  })
})
