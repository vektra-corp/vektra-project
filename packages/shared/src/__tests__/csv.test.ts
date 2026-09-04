import { describe, expect, it } from 'vitest'
import { neutralizeFormula, parseCsv, parseCsvTable, toCsv } from '../utils/csv'

const columns = [
  { key: 'title' as const, label: 'Title' },
  { key: 'status' as const, label: 'Status' },
]

describe('toCsv', () => {
  it('writes a header and CRLF-separated rows', () => {
    const csv = toCsv([{ title: 'Ship it', status: 'todo' }], columns)
    expect(csv).toBe('Title,Status\r\nShip it,todo\r\n')
  })

  it('follows the column order given, not the object key order', () => {
    const csv = toCsv([{ status: 'todo', title: 'Ship it' }], columns)
    expect(csv.split('\r\n')[1]).toBe('Ship it,todo')
  })

  it('quotes a field containing a comma', () => {
    const csv = toCsv([{ title: 'Ship it, then rest', status: 'todo' }], columns)
    expect(csv).toContain('"Ship it, then rest"')
  })

  it('doubles embedded quotes', () => {
    const csv = toCsv([{ title: 'The "big" one', status: 'todo' }], columns)
    expect(csv).toContain('"The ""big"" one"')
  })

  it('quotes a field containing a newline rather than breaking the row', () => {
    const csv = toCsv([{ title: 'line one\nline two', status: 'todo' }], columns)
    expect(csv).toContain('"line one\nline two"')
    // The document still has exactly one data row.
    expect(parseCsv(csv)).toHaveLength(2)
  })

  it('writes null and undefined as empty, not as the words', () => {
    const csv = toCsv([{ title: null, status: undefined }], columns)
    expect(csv.split('\r\n')[1]).toBe(',')
  })

  it('serialises dates and objects predictably', () => {
    const csv = toCsv(
      [{ title: new Date('2026-09-05T00:00:00Z'), status: { a: 1 } }],
      columns,
    )
    expect(csv).toContain('2026-09-05T00:00:00.000Z')
    expect(csv).toContain('"{""a"":1}"')
  })

  it('emits only a header for no rows', () => {
    expect(toCsv([], columns)).toBe('Title,Status\r\n')
  })
})

describe('neutralizeFormula', () => {
  it('prefixes the characters a spreadsheet executes', () => {
    // OWASP CSV injection: our export contains text the customer's own users
    // typed, so an unneutralised cell is a delivery mechanism.
    for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', '=cmd|\' /c calc\'!A1']) {
      expect(neutralizeFormula(value)).toBe(`'${value}`)
    }
  })

  it('leaves ordinary text untouched', () => {
    for (const value of ['Ship it', 'a-b', '1+1', '', 'todo']) {
      expect(neutralizeFormula(value)).toBe(value)
    }
  })

  it('preserves the original value rather than stripping it', () => {
    // Stripping would turn -5 into 5, which is a data corruption bug dressed up
    // as a security fix.
    expect(neutralizeFormula('-5')).toBe("'-5")
  })

  it('applies through toCsv', () => {
    const csv = toCsv([{ title: '=HYPERLINK("http://evil")', status: 'todo' }], columns)
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`)
  })
})

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('accepts LF as well as CRLF', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('parses a quoted field containing a comma', () => {
    expect(parseCsv('a,b\r\n"one, two",3\r\n')[1]).toEqual(['one, two', '3'])
  })

  it('parses a quoted field containing a newline', () => {
    const rows = parseCsv('a,b\r\n"line one\nline two",3\r\n')
    expect(rows).toHaveLength(2)
    expect(rows[1]![0]).toBe('line one\nline two')
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\r\n"The ""big"" one"\r\n')[1]).toEqual(['The "big" one'])
  })

  it('keeps empty cells', () => {
    expect(parseCsv('a,b,c\r\n1,,3\r\n')[1]).toEqual(['1', '', '3'])
  })

  it('handles a file with no trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('does not emit a phantom row for a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toHaveLength(2)
  })

  it('strips a byte-order mark, which would otherwise corrupt the first header', () => {
    // Excel writes one. Without stripping, the first column never maps.
    expect(parseCsv('\uFEFFa,b\r\n1,2\r\n')[0]).toEqual(['a', 'b'])
  })

  it('round-trips everything toCsv can produce', () => {
    const tricky = [
      { title: 'plain', status: 'a' },
      { title: 'with, comma', status: 'b' },
      { title: 'with "quotes"', status: 'c' },
      { title: 'with\nnewline', status: 'd' },
      { title: '', status: '' },
    ]
    const parsed = parseCsv(toCsv(tricky, columns))
    expect(parsed.slice(1).map((row) => row[0])).toEqual([
      'plain',
      'with, comma',
      'with "quotes"',
      'with\nnewline',
      '',
    ])
  })

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\r\n')).toEqual([])
  })
})

describe('parseCsvTable', () => {
  it('keys rows by header and trims', () => {
    const table = parseCsvTable('Title , Status\r\n Ship it , todo \r\n')
    expect(table.headers).toEqual(['Title', 'Status'])
    expect(table.rows).toEqual([{ Title: 'Ship it', Status: 'todo' }])
  })

  it('pads a short row instead of throwing', () => {
    const table = parseCsvTable('a,b,c\r\n1,2\r\n')
    expect(table.rows[0]).toEqual({ a: '1', b: '2', c: '' })
  })

  it('ignores cells beyond the header', () => {
    const table = parseCsvTable('a,b\r\n1,2,3\r\n')
    expect(table.rows[0]).toEqual({ a: '1', b: '2' })
  })

  it('disambiguates duplicate headers rather than overwriting', () => {
    // Two columns called "Name" would otherwise silently collapse into one.
    const table = parseCsvTable('Name,Name\r\nfirst,second\r\n')
    expect(table.headers).toEqual(['Name', 'Name (2)'])
    expect(table.rows[0]).toEqual({ Name: 'first', 'Name (2)': 'second' })
  })

  it('handles a header-only file', () => {
    expect(parseCsvTable('a,b\r\n')).toEqual({ headers: ['a', 'b'], rows: [] })
  })

  it('handles an empty file', () => {
    expect(parseCsvTable('')).toEqual({ headers: [], rows: [] })
  })
})
