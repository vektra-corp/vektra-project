import { describe, expect, it } from 'vitest'
import {
  parseImportDate,
  validateContactRows,
  validateTaskRows,
} from '../constants/import-rows'

describe('parseImportDate', () => {
  it('accepts ISO', () => {
    expect(parseImportDate('2026-09-05')).toEqual({ ok: true, value: '2026-09-05' })
  })

  it('treats blank as absent, not as an error', () => {
    expect(parseImportDate('')).toEqual({ ok: true, value: null })
    expect(parseImportDate('   ')).toEqual({ ok: true, value: null })
  })

  it('rejects a date that matches the pattern but does not exist', () => {
    // 2026-02-30 passes a regex and fails reality.
    expect(parseImportDate('2026-02-30').ok).toBe(false)
    expect(parseImportDate('2026-13-01').ok).toBe(false)
  })

  it('refuses an ambiguous slashed date rather than guessing', () => {
    // 03/04/2026 is March 4th in the US and 4 March elsewhere. Nothing in the
    // file says which, and picking one silently corrupts the import.
    const result = parseImportDate('03/04/2026')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/day\/month or month\/day/)
  })

  it('accepts a slashed date the day settles', () => {
    // 25 cannot be a month, so the order is unambiguous either way round.
    expect(parseImportDate('25/12/2026')).toEqual({ ok: true, value: '2026-12-25' })
    expect(parseImportDate('12/25/2026')).toEqual({ ok: true, value: '2026-12-25' })
  })

  it('rejects an unambiguous-looking but impossible slashed date', () => {
    expect(parseImportDate('32/01/2026').ok).toBe(false)
  })

  it('rejects free text', () => {
    for (const value of ['tomorrow', 'Sept 5', '2026/09/05', '05-09-2026']) {
      expect(parseImportDate(value).ok).toBe(false)
    }
  })
})

describe('validateTaskRows', () => {
  const mapping = {
    title: 'Title',
    status: 'Status',
    priority: 'Priority',
    due_date: 'Due date',
    estimated_hours: 'Hours',
    assignee_email: 'Assignee',
  }

  it('accepts a good row and applies defaults', () => {
    const { valid, errors } = validateTaskRows([{ Title: 'Ship it' }], mapping)
    expect(errors).toEqual([])
    expect(valid[0]).toMatchObject({ title: 'Ship it', status: 'todo', priority: 'medium' })
  })

  it('requires a title', () => {
    const { valid, errors } = validateTaskRows([{ Title: '   ' }], mapping)
    expect(valid).toHaveLength(0)
    expect(errors[0]?.message).toMatch(/Title is required/)
  })

  it('numbers rows the way a spreadsheet does', () => {
    // Row 1 is the header, so the first data row is 2 — otherwise someone
    // hunts the wrong line.
    const { errors } = validateTaskRows([{ Title: 'ok' }, { Title: '' }], mapping)
    expect(errors[0]?.row).toBe(3)
  })

  it('rejects the bad row and keeps the good ones', () => {
    const { valid, errors } = validateTaskRows(
      [{ Title: 'one' }, { Title: '' }, { Title: 'three' }],
      mapping,
    )
    expect(valid.map((row) => row.title)).toEqual(['one', 'three'])
    expect(errors).toHaveLength(1)
  })

  it('normalises status and priority casing and spacing', () => {
    const { valid } = validateTaskRows(
      [{ Title: 'x', Status: 'In Progress', Priority: 'HIGH' }],
      mapping,
    )
    expect(valid[0]).toMatchObject({ status: 'in_progress', priority: 'high' })
  })

  it('names the allowed values when a choice is wrong', () => {
    const { errors } = validateTaskRows([{ Title: 'x', Status: 'blocked' }], mapping)
    expect(errors[0]?.message).toMatch(/not one of: todo/)
  })

  it('collects every problem on a row, not just the first', () => {
    const { errors } = validateTaskRows(
      [{ Title: '', Status: 'nope', Hours: 'abc' }],
      mapping,
    )
    expect(errors[0]?.message).toMatch(/Title is required/)
    expect(errors[0]?.message).toMatch(/not one of/)
    expect(errors[0]?.message).toMatch(/not a number/)
  })

  it('accepts a comma decimal separator', () => {
    const { valid } = validateTaskRows([{ Title: 'x', Hours: '7,5' }], mapping)
    expect(valid[0]?.estimated_hours).toBe(7.5)
  })

  it('rejects negative hours', () => {
    const { errors } = validateTaskRows([{ Title: 'x', Hours: '-3' }], mapping)
    expect(errors).toHaveLength(1)
  })

  it('lowercases the assignee email so lookup is case-insensitive', () => {
    const { valid } = validateTaskRows([{ Title: 'x', Assignee: 'Ada@Example.COM' }], mapping)
    expect(valid[0]?.assignee_email).toBe('ada@example.com')
  })

  it('ignores columns that are not mapped', () => {
    const { valid } = validateTaskRows([{ Title: 'x', Status: 'nonsense' }], { title: 'Title' })
    expect(valid[0]?.status).toBe('todo')
  })
})

describe('validateContactRows', () => {
  const mapping = {
    contact_name: 'Name',
    company_name: 'Company',
    type: 'Type',
    email: 'Email',
    city: 'City',
    country: 'Country',
  }

  it('accepts a good row', () => {
    const { valid, errors } = validateContactRows(
      [{ Name: 'Pat', Company: 'Client Co', Type: 'vendor', Email: 'pat@client.test' }],
      mapping,
    )
    expect(errors).toEqual([])
    expect(valid[0]).toMatchObject({ contact_name: 'Pat', type: 'vendor' })
  })

  it('requires a name', () => {
    expect(validateContactRows([{ Name: '' }], mapping).errors).toHaveLength(1)
  })

  it('defaults the type to client', () => {
    expect(validateContactRows([{ Name: 'Pat' }], mapping).valid[0]?.type).toBe('client')
  })

  it('rejects an obviously wrong email', () => {
    expect(validateContactRows([{ Name: 'Pat', Email: 'not-an-email' }], mapping).errors).toHaveLength(1)
  })

  it('builds an address only from the parts present', () => {
    const { valid } = validateContactRows([{ Name: 'Pat', City: 'Leeds' }], mapping)
    expect(valid[0]?.address).toEqual({ city: 'Leeds' })
  })

  it('stores no address rather than one of empty strings', () => {
    const { valid } = validateContactRows([{ Name: 'Pat', City: '', Country: '' }], mapping)
    expect(valid[0]?.address).toBeNull()
  })

  it('turns blank optional fields into null, not empty strings', () => {
    const { valid } = validateContactRows([{ Name: 'Pat', Company: '  ' }], mapping)
    expect(valid[0]?.company_name).toBeNull()
  })
})
