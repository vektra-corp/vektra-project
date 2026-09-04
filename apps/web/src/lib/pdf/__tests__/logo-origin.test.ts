import { describe, expect, it } from 'vitest'
import { isOwnStorageUrl } from '../logo-origin'

const SUPABASE = 'https://abcdefgh.supabase.co'

describe('isOwnStorageUrl', () => {
  it('accepts a storage object on our own project', () => {
    expect(
      isOwnStorageUrl(`${SUPABASE}/storage/v1/object/public/logos/acme.png`, SUPABASE),
    ).toBe(true)
    expect(
      isOwnStorageUrl(`${SUPABASE}/storage/v1/object/sign/logos/acme.png?token=x`, SUPABASE),
    ).toBe(true)
  })

  it('refuses another host entirely', () => {
    expect(isOwnStorageUrl('https://evil.example/logo.png', SUPABASE)).toBe(false)
  })

  it('refuses a lookalike host', () => {
    // The two shapes a substring check would wave through.
    expect(
      isOwnStorageUrl('https://evil-project.supabase.co/storage/v1/object/x.png', SUPABASE),
    ).toBe(false)
    expect(
      isOwnStorageUrl('https://abcdefgh.supabase.co.attacker.test/storage/v1/object/x.png', SUPABASE),
    ).toBe(false)
  })

  it('refuses a host that merely contains ours as a prefix', () => {
    expect(
      isOwnStorageUrl('https://abcdefgh.supabase.co.evil.test/storage/v1/object/x.png', SUPABASE),
    ).toBe(false)
  })

  it('refuses http, so a logo cannot be swapped in transit', () => {
    expect(
      isOwnStorageUrl('http://abcdefgh.supabase.co/storage/v1/object/public/x.png', SUPABASE),
    ).toBe(false)
  })

  it('refuses a non-storage path on our own host', () => {
    // Right host, wrong endpoint — this would reach the REST or auth API.
    expect(isOwnStorageUrl(`${SUPABASE}/rest/v1/organizations`, SUPABASE)).toBe(false)
    expect(isOwnStorageUrl(`${SUPABASE}/auth/v1/token`, SUPABASE)).toBe(false)
  })

  it('refuses a path that only contains the storage prefix later', () => {
    expect(isOwnStorageUrl(`${SUPABASE}/x/storage/v1/object/y.png`, SUPABASE)).toBe(false)
  })

  it('refuses other schemes', () => {
    expect(isOwnStorageUrl('data:image/png;base64,AAAA', SUPABASE)).toBe(false)
    expect(isOwnStorageUrl('file:///etc/passwd', SUPABASE)).toBe(false)
  })

  it('fails closed when the URL or the configured base is unusable', () => {
    expect(isOwnStorageUrl('not a url', SUPABASE)).toBe(false)
    expect(isOwnStorageUrl(`${SUPABASE}/storage/v1/object/x.png`, undefined)).toBe(false)
    expect(isOwnStorageUrl(`${SUPABASE}/storage/v1/object/x.png`, 'nonsense')).toBe(false)
    expect(isOwnStorageUrl('', SUPABASE)).toBe(false)
  })
})
