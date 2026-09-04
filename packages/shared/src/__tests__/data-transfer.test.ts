import { describe, expect, it } from 'vitest'
import { IMPORT_FIELDS, guessMapping } from '../constants/data-transfer'

describe('guessMapping', () => {
  const taskFields = IMPORT_FIELDS.tasks

  it('matches our own export headers exactly', () => {
    // Round-tripping an export back through an import is the common case.
    const mapping = guessMapping(['Title', 'Status', 'Priority', 'Due date'], taskFields)
    expect(mapping).toMatchObject({
      title: 'Title',
      status: 'Status',
      priority: 'Priority',
      due_date: 'Due date',
    })
  })

  it('is case- and separator-insensitive', () => {
    const mapping = guessMapping(['  TITLE  ', 'due_date', 'Estimated-Hours'], taskFields)
    expect(mapping.title).toBe('  TITLE  ')
    expect(mapping.due_date).toBe('due_date')
    expect(mapping.estimated_hours).toBe('Estimated-Hours')
  })

  it('matches aliases from other tools', () => {
    const mapping = guessMapping(['Summary', 'Deadline', 'Owner'], taskFields)
    expect(mapping.title).toBe('Summary')
    expect(mapping.due_date).toBe('Deadline')
    expect(mapping.assignee_email).toBe('Owner')
  })

  it('never assigns one header to two fields', () => {
    const mapping = guessMapping(['Name'], IMPORT_FIELDS.contacts)
    const used = Object.values(mapping)
    expect(new Set(used).size).toBe(used.length)
  })

  it('leaves a field unmapped rather than guessing wildly', () => {
    const mapping = guessMapping(['Colour', 'Shape'], taskFields)
    expect(mapping.title).toBeUndefined()
  })

  it('does not let a short label match half the file', () => {
    // A two-letter field name must not swallow every header containing it.
    const mapping = guessMapping(['Description of the widget'], IMPORT_FIELDS.contacts)
    expect(mapping.city).toBeUndefined()
  })

  it('prefers an exact match over a contains match', () => {
    const mapping = guessMapping(['Company name detail', 'Company'], IMPORT_FIELDS.contacts)
    expect(mapping.company_name).toBe('Company')
  })

  it('returns nothing for no headers', () => {
    expect(guessMapping([], taskFields)).toEqual({})
  })
})
