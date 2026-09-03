import { describe, expect, it } from 'vitest'
import { RESERVED_SLUGS, isValidSlug, slugify, uniqueSlug } from '../utils/slug'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp')
  })

  it('strips diacritics', () => {
    expect(slugify('Café Münchén')).toBe('cafe-munchen')
  })

  it('collapses runs of separators and trims them', () => {
    expect(slugify('  --Hello___World!!  ')).toBe('hello-world')
  })

  it('drops characters with no ASCII equivalent', () => {
    expect(slugify('日本語')).toBe('')
  })

  it('caps length without leaving a trailing hyphen', () => {
    const result = slugify('a'.repeat(40) + ' ' + 'b'.repeat(40))
    expect(result.length).toBeLessThanOrEqual(48)
    expect(result.endsWith('-')).toBe(false)
  })
})

describe('isValidSlug', () => {
  it('accepts well-formed slugs', () => {
    expect(isValidSlug('acme')).toBe(true)
    expect(isValidSlug('acme-corp-2')).toBe(true)
  })

  it('rejects malformed slugs', () => {
    expect(isValidSlug('a')).toBe(false)
    expect(isValidSlug('-acme')).toBe(false)
    expect(isValidSlug('acme-')).toBe(false)
    expect(isValidSlug('Acme')).toBe(false)
    expect(isValidSlug('acme corp')).toBe(false)
  })

  // Reserved slugs would shadow app routes such as /login and /api.
  it('rejects reserved slugs', () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(isValidSlug(reserved)).toBe(false)
    }
  })
})

describe('uniqueSlug', () => {
  it('returns the base slug when it is free', () => {
    expect(uniqueSlug('Acme Corp', [])).toBe('acme-corp')
  })

  it('appends the first free suffix', () => {
    expect(uniqueSlug('Acme', ['acme'])).toBe('acme-2')
    expect(uniqueSlug('Acme', ['acme', 'acme-2', 'acme-3'])).toBe('acme-4')
  })

  it('avoids reserved slugs even when unused', () => {
    expect(uniqueSlug('Admin', [])).not.toBe('admin')
  })

  it('falls back for input with no usable characters', () => {
    expect(uniqueSlug('!!!', [])).toBe('untitled')
  })
})
