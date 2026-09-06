import { describe, expect, it } from 'vitest'
import { taskReference } from '../utils/format'
import { isPublicId, parsePublicId, publicIdToString } from '../utils/public-id'
import { projectKeySchema } from '../validators/project'

/**
 * The two identifiers a project carries, and the rules that keep them apart.
 *
 * `public_id` is generated, opaque, permanent and always sixteen digits.
 * `key` is chosen by a person, short, and editable. Confusing them is the
 * failure mode these tests exist to catch.
 */

describe('parsePublicId', () => {
  it('accepts exactly sixteen digits', () => {
    expect(parsePublicId('1739284650193847')).toBe('1739284650193847')
    // The bounds the generator actually produces (migration 00034).
    expect(parsePublicId('1000000000000000')).toBe('1000000000000000')
    expect(parsePublicId('8999999999999999')).toBe('8999999999999999')
  })

  it('tolerates surrounding whitespace from a pasted URL', () => {
    expect(parsePublicId('  1739284650193847 ')).toBe('1739284650193847')
  })

  it('rejects anything that is not sixteen digits', () => {
    for (const value of [
      '173928465019384', // fifteen
      '17392846501938470', // seventeen
      '1739284650193 47', // internal space
      '-1739284650193847', // signed
      '1739284650193847.0', // decimal
      '1,739,284,650,193,847', // separators
      '173928465019384a',
      '',
    ]) {
      expect(parsePublicId(value), value).toBeNull()
    }
  })

  it('rejects a uuid, which is what these ids replaced', () => {
    // The whole point of the change: a uuid must never resolve as a public id,
    // or an old bookmark would half-work in a way nobody could diagnose.
    expect(parsePublicId('4e0e0a1e-1c2b-4a3d-9f10-8a7b6c5d4e3f')).toBeNull()
  })

  it('rejects a non-string without throwing', () => {
    expect(parsePublicId(undefined)).toBeNull()
    expect(parsePublicId(null)).toBeNull()
  })
})

describe('isPublicId', () => {
  it('narrows only genuine ids', () => {
    expect(isPublicId('1739284650193847')).toBe(true)
    expect(isPublicId(1739284650193847)).toBe(false)
    expect(isPublicId(null)).toBe(false)
  })
})

describe('publicIdToString', () => {
  it('renders a JSON number as its exact digits', () => {
    // Every generated id is below 2^53, so this is a formatting step and not a
    // conversion that could lose anything.
    expect(publicIdToString(1739284650193847)).toBe('1739284650193847')
    expect(publicIdToString(8999999999999999)).toBe('8999999999999999')
    expect(publicIdToString(1000000000000000)).toBe('1000000000000000')
  })

  it('never produces scientific notation', () => {
    // A URL containing "1e+15" 404s, and would do so only for some ids.
    for (const value of [1e15, 8999999999999999, 1234567890123456]) {
      expect(publicIdToString(value)).toMatch(/^\d{16}$/)
    }
  })

  it('passes a string through unchanged', () => {
    expect(publicIdToString('1739284650193847')).toBe('1739284650193847')
  })

  it('renders absence as the empty string rather than "null"', () => {
    expect(publicIdToString(null)).toBe('')
    expect(publicIdToString(undefined)).toBe('')
  })
})

describe('taskReference', () => {
  it('reads as people say it', () => {
    expect(taskReference('VEK', 241)).toBe('VEK-241')
  })

  it('falls back rather than emitting a bare hyphen', () => {
    expect(taskReference('', 7)).toBe('TSK-7')
  })
})

describe('projectKeySchema', () => {
  it('upper-cases rather than failing on case', () => {
    expect(projectKeySchema.parse('vek')).toBe('VEK')
    expect(projectKeySchema.parse('  ops2  ')).toBe('OPS2')
  })

  it('accepts two to ten characters starting with a letter', () => {
    expect(projectKeySchema.safeParse('AB').success).toBe(true)
    expect(projectKeySchema.safeParse('ABCDEFGHIJ').success).toBe(true)
    expect(projectKeySchema.safeParse('A1B2C3').success).toBe(true)
  })

  it('rejects what the database CHECK would reject', () => {
    for (const value of [
      'A', // too short
      'ABCDEFGHIJK', // eleven
      '1AB', // starts with a digit
      '2024', // digits only
      'VEK-1', // a hyphen would make VEK-1-42 unreadable
      'VE K',
      'VÉK',
      '',
    ]) {
      expect(projectKeySchema.safeParse(value).success, value).toBe(false)
    }
  })
})
