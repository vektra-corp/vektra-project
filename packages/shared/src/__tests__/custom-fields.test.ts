import { describe, expect, it } from 'vitest'
import {
  coerceCustomValue,
  parseFieldOptions,
  validateCustomValue,
  type CustomFieldDefinition,
} from '../constants/custom-fields'

const field = (over: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition => ({
  id: 'f1',
  entity_type: 'task',
  name: 'Field',
  field_type: 'text',
  options: [],
  is_required: false,
  position: 0,
  ...over,
})

describe('coerceCustomValue', () => {
  it('treats an absent checkbox as false, not null', () => {
    // An unchecked box submits nothing at all; null would read as "unanswered".
    expect(coerceCustomValue('checkbox', undefined)).toBe(false)
    expect(coerceCustomValue('checkbox', 'on')).toBe(true)
    expect(coerceCustomValue('checkbox', true)).toBe(true)
  })

  it('turns an empty string into null for every other type', () => {
    for (const type of ['text', 'number', 'date', 'url', 'email', 'currency'] as const) {
      expect(coerceCustomValue(type, '   ')).toBeNull()
    }
  })

  it('parses numbers and rejects junk rather than storing NaN', () => {
    expect(coerceCustomValue('number', '42.5')).toBe(42.5)
    expect(coerceCustomValue('currency', '1200')).toBe(1200)
    expect(coerceCustomValue('number', 'abc')).toBeNull()
  })

  it('trims text', () => {
    expect(coerceCustomValue('text', '  hello  ')).toBe('hello')
  })
})

describe('validateCustomValue', () => {
  it('enforces required, except on checkboxes', () => {
    expect(validateCustomValue(field({ is_required: true }), null)?.message).toContain('required')
    // A required checkbox meaning "must be ticked" is a different feature; an
    // unticked box is a legitimate answer.
    expect(
      validateCustomValue(field({ field_type: 'checkbox', is_required: true }), false),
    ).toBeNull()
  })

  it('accepts an empty optional field', () => {
    expect(validateCustomValue(field(), null)).toBeNull()
  })

  it('rejects a URL that is not http or https', () => {
    const url = field({ field_type: 'url', name: 'Link' })
    expect(validateCustomValue(url, 'https://example.com')).toBeNull()
    // javascript: would be an XSS vector the moment it is rendered as a link.
    expect(validateCustomValue(url, 'javascript:alert(1)')?.message).toContain('http')
    expect(validateCustomValue(url, 'not a url')?.message).toContain('http')
  })

  it('rejects a dropdown value outside its options', () => {
    const dropdown = field({ field_type: 'dropdown', options: ['A', 'B'] })
    expect(validateCustomValue(dropdown, 'A')).toBeNull()
    expect(validateCustomValue(dropdown, 'C')?.message).toContain('listed options')
  })

  it('checks dates and emails by shape', () => {
    expect(validateCustomValue(field({ field_type: 'date' }), '2026-03-01')).toBeNull()
    expect(validateCustomValue(field({ field_type: 'date' }), '01/03/2026')).not.toBeNull()
    expect(validateCustomValue(field({ field_type: 'email' }), 'a@b.co')).toBeNull()
    expect(validateCustomValue(field({ field_type: 'email' }), 'a@b')).not.toBeNull()
  })

  it('caps text length', () => {
    expect(validateCustomValue(field(), 'x'.repeat(2000))).toBeNull()
    expect(validateCustomValue(field(), 'x'.repeat(2001))?.message).toContain('too long')
  })
})

describe('parseFieldOptions', () => {
  it('keeps only non-empty strings', () => {
    expect(parseFieldOptions(['A', '', 'B', 3, null])).toEqual(['A', 'B'])
  })

  it('returns an empty list for anything that is not an array', () => {
    expect(parseFieldOptions(null)).toEqual([])
    expect(parseFieldOptions({ a: 1 })).toEqual([])
  })
})
