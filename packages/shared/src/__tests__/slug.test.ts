import { describe, expect, it } from 'vitest'
import { RESERVED_SLUGS, isValidSlug, projectKey, slugify, uniqueSlug } from '../utils/slug'

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

describe('projectKey', () => {
  // The key column carries CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'), so every
  // derived value has to satisfy that or the insert fails.
  const LEGAL = /^[A-Z][A-Z0-9]{1,9}$/

  it('takes the first three letters of a single leading word', () => {
    expect(projectKey('Atlas Migration')).toBe('ATL')
    expect(projectKey('Platform')).toBe('PLA')
  })

  it('combines short words rather than emitting a one-letter key', () => {
    expect(projectKey('Go Live')).toBe('GOL')
    expect(projectKey('R D')).toBe('RD')
  })

  it('ignores punctuation and falls back for an empty name', () => {
    expect(projectKey('  @@@ ')).toBe('PRJ')
    expect(projectKey('web-app rewrite')).toBe('WEB')
  })

  it('never starts the key with a digit', () => {
    // '3M Rollout' would otherwise derive '3MR', which the CHECK rejects.
    expect(projectKey('3M Rollout')).toBe('MR')
    expect(projectKey('2024')).toBe('PRJ')
  })

  it('always produces a value the column will accept', () => {
    for (const name of [
      'Atlas Migration',
      'Q',
      '3M Rollout',
      '2024',
      '  @@@ ',
      'web-app rewrite',
      'Go Live',
    ]) {
      expect(projectKey(name)).toMatch(LEGAL)
    }
  })
})
