/**
 * CSV encoding and parsing (RFC 4180).
 *
 * Written rather than pulled in: the format is small, the edge cases are the
 * whole job, and a dependency here would still need this much testing to trust.
 *
 * Two things this handles that a naive `split(',')` does not, and that matter:
 *
 *  - **Quoted fields** containing commas, quotes and literal newlines. A task
 *    title with a comma in it is not exotic.
 *  - **Formula injection.** A cell beginning `=`, `+`, `-`, `@` or a control
 *    character is executed as a formula when the file is opened in Excel or
 *    Sheets. Since our export contains text a customer's own users typed, an
 *    exported CSV is a delivery mechanism for `=cmd|...` unless neutralised.
 *    See OWASP "CSV Injection". Neutralising happens on WRITE, because the
 *    reader is a spreadsheet we do not control.
 */

const NEEDS_QUOTING = /[",\r\n]/
/** Leading characters a spreadsheet treats as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * Make a value safe to open in a spreadsheet.
 *
 * A leading apostrophe is the conventional fix: spreadsheets treat it as "this
 * is text", strip it on display, and it round-trips through our own parser as
 * an ordinary character. Prefixing is preferred over stripping because the
 * original value stays legible — `-5` must not silently become `5`.
 */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}

function encodeCell(value: unknown): string {
  if (value === null || value === undefined) return ''

  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)

  const safe = neutralizeFormula(text)
  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/**
 * Rows to a CSV document.
 *
 * `columns` fixes the order and the header, so the output does not depend on
 * key insertion order in the objects handed in.
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly { key: keyof T & string; label: string }[],
): string {
  const header = columns.map((column) => encodeCell(column.label)).join(',')
  const body = rows.map((row) => columns.map((column) => encodeCell(row[column.key])).join(','))
  // A trailing newline: POSIX text convention, and some parsers drop the last
  // row without it.
  return [header, ...body].join('\r\n') + '\r\n'
}

/**
 * Parse a CSV document into rows of cells.
 *
 * A hand-written state machine rather than a regex: quoted fields may contain
 * the delimiter, the quote character (doubled) and literal newlines, none of
 * which a line-based split survives.
 *
 * Lenient where leniency is safe — a stray quote inside an unquoted field is
 * kept as text rather than throwing, because a half-imported file that fails on
 * row 900 is worse than one that imports row 900 slightly oddly and reports it.
 */
export function parseCsv(input: string): string[][] {
  // A BOM is invisible and would otherwise become part of the first header,
  // so the first column silently fails to map.
  const text = input.replace(/^\uFEFF/, '')

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let index = 0

  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
  }

  while (index < text.length) {
    const char = text[index]!

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      cell += char
      index += 1
      continue
    }

    if (char === '"' && cell === '') {
      quoted = true
      index += 1
      continue
    }

    if (char === ',') {
      endCell()
      index += 1
      continue
    }

    if (char === '\r' || char === '\n') {
      endRow()
      // CRLF is one row break, not two.
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1
      continue
    }

    cell += char
    index += 1
  }

  // A file not ending in a newline still has a final row.
  if (cell !== '' || row.length > 0) endRow()

  // A trailing newline produces one empty row; drop it rather than importing a
  // blank record.
  return rows.filter((entry) => entry.length > 1 || entry[0] !== '')
}

export interface CsvTable {
  headers: string[]
  rows: Record<string, string>[]
}

/**
 * Parse into header-keyed records.
 *
 * Rows shorter than the header are padded and rows longer are truncated, so a
 * ragged file imports what it can instead of throwing. Duplicate headers are
 * disambiguated rather than silently overwriting each other.
 */
export function parseCsvTable(input: string): CsvTable {
  const rows = parseCsv(input)
  if (rows.length === 0) return { headers: [], rows: [] }

  const seen = new Map<string, number>()
  const headers = rows[0]!.map((raw) => {
    const name = raw.trim()
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name} (${count + 1})`
  })

  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {}
    headers.forEach((header, position) => {
      record[header] = cells[position]?.trim() ?? ''
    })
    return record
  })

  return { headers, rows: records }
}
