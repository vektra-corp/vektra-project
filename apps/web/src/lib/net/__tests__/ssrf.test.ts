import { describe, expect, it } from 'vitest'
import { checkWebhookUrl, isBlockedAddress } from '../ssrf'

describe('checkWebhookUrl', () => {
  it('accepts ordinary public https and http URLs', () => {
    expect(checkWebhookUrl('https://hooks.example.com/abc').ok).toBe(true)
    expect(checkWebhookUrl('http://example.com:8080/hook').ok).toBe(true)
  })

  it('refuses non-web schemes', () => {
    for (const url of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/']) {
      expect(checkWebhookUrl(url).ok).toBe(false)
    }
  })

  it('refuses credentials in the URL', () => {
    // They would be forwarded to wherever it redirects.
    expect(checkWebhookUrl('https://user:pass@example.com/x').ok).toBe(false)
  })

  it('refuses non-web ports, so a webhook cannot scan internal services', () => {
    for (const port of [22, 25, 3306, 5432, 6379, 11211]) {
      expect(checkWebhookUrl(`https://example.com:${port}/x`).ok).toBe(false)
    }
  })

  it('refuses a bare internal hostname', () => {
    for (const host of ['http://localhost/x', 'http://redis/x', 'http://metadata/x']) {
      expect(checkWebhookUrl(host).ok).toBe(false)
    }
  })

  it('refuses junk', () => {
    expect(checkWebhookUrl('not a url').ok).toBe(false)
    expect(checkWebhookUrl('').ok).toBe(false)
  })

  it('reports why, so the step log is useful', () => {
    const verdict = checkWebhookUrl('ftp://example.com/')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/scheme/i)
  })
})

describe('isBlockedAddress', () => {
  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '192.167.1.1']) {
      expect(isBlockedAddress(ip)).toBe(false)
    }
  })

  it('blocks loopback, private and link-local IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '0.0.0.0',
      '100.64.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isBlockedAddress(ip)).toBe(true)
    }
  })

  it('blocks the cloud metadata address', () => {
    // The single most valuable SSRF target: it hands out role credentials.
    expect(isBlockedAddress('169.254.169.254')).toBe(true)
  })

  it('gets the 172.16/12 boundary right', () => {
    expect(isBlockedAddress('172.15.255.255')).toBe(false)
    expect(isBlockedAddress('172.16.0.0')).toBe(true)
    expect(isBlockedAddress('172.31.255.255')).toBe(true)
    expect(isBlockedAddress('172.32.0.0')).toBe(false)
  })

  it('blocks IPv6 loopback and local ranges', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '[::1]']) {
      expect(isBlockedAddress(ip)).toBe(true)
    }
  })

  it('allows public IPv6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('sees through IPv4-mapped IPv6', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false)
  })

  it('blocks transition ranges that reach v4 space', () => {
    expect(isBlockedAddress('64:ff9b::7f00:1')).toBe(true)
    expect(isBlockedAddress('2002:7f00:1::')).toBe(true)
  })

  it('fails closed on anything it cannot classify', () => {
    // An address we cannot judge is not one to connect to (§2, fail closed).
    for (const value of ['', '   ', 'example.com', '1.2.3', '1.2.3.4.5', '999.1.1.1', '0x7f.1']) {
      expect(isBlockedAddress(value)).toBe(true)
    }
  })
})
