import type { ImportOutcome, RowError } from './data-transfer'
import { PRIORITIES, TASK_STATUSES } from './statuses'

/**
 * Row validation for CSV imports (§20 Phase 2).
 *
 * Pure, and separate from the insert, for two reasons: it is the part worth
 * testing exhaustively, and it lets the UI show what WILL happen before
 * anything is written. An import that reports its problems after writing half
 * the file is the thing to avoid.
 *
 * The posture throughout is: reject the row, never the file. A single bad date
 * on line 400 must not discard the other 399 — the caller imports what is valid
 * and reports the rest by line number.
 *
 * Row numbers are 1-based counting the header, so they match what a spreadsheet
 * shows in its gutter. Off-by-one here means someone hunts the wrong line.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Accepts ISO and the two common spreadsheet orders.
 *
 * Ambiguity is real: 03/04/2026 is March 4th in the US and 4th March elsewhere,
 * and nothing in the file says which. Rather than guess, a slashed date is
 * accepted ONLY when it cannot be read both ways — a day above 12 settles it.
 * Everything else is rejected with a message naming the format to use.
 */
export function parseImportDate(raw: string): { ok: true; value: string | null } | { ok: false; reason: string } {
  const value = raw.trim()
  if (!value) return { ok: true, value: null }

  if (DATE.test(value)) {
    const date = new Date(`${value}T00:00:00Z`)
    // Catches 2026-02-30, which matches the pattern but is not a date.
    if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(value)) {
      return { ok: false, reason: `"${value}" is not a real date` }
    }
    return { ok: true, value }
  }

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  if (slashed) {
    const [, a, b, year] = slashed as unknown as [string, string, string, string]
    const first = Number(a)
    const second = Number(b)

    // Both readable as a month: genuinely ambiguous, so refuse rather than
    // silently importing the wrong date.
    if (first <= 12 && second <= 12) {
      return {
        ok: false,
        reason: `"${value}" could be day/month or month/day — use YYYY-MM-DD`,
      }
    }

    const day = first > 12 ? first : second
    const month = first > 12 ? second : first
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const date = new Date(`${iso}T00:00:00Z`)
    if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(iso)) {
      return { ok: false, reason: `"${value}" is not a real date` }
    }
    return { ok: true, value: iso }
  }

  return { ok: false, reason: `"${value}" is not a date — use YYYY-MM-DD` }
}

function parseChoice(
  raw: string,
  allowed: readonly string[],
  fallback: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!value) return { ok: true, value: fallback }
  if (allowed.includes(value)) return { ok: true, value }
  return { ok: false, reason: `"${raw.trim()}" is not one of: ${allowed.join(', ')}` }
}

export interface TaskImportRow {
  title: string
  status: string
  priority: string
  assignee_email: string | null
  start_date: string | null
  due_date: string | null
  estimated_hours: number | null
}

export interface ContactImportRow {
  contact_name: string
  company_name: string | null
  type: string
  email: string | null
  phone: string | null
  tax_id: string | null
  notes: string | null
  address: { street?: string; city?: string; country?: string } | null
}

/** Read a mapped field out of a row, or '' when the field is unmapped. */
const field = (
  row: Record<string, string>,
  mapping: Record<string, string>,
  key: string,
): string => {
  const header = mapping[key]
  return header ? (row[header] ?? '').trim() : ''
}

export function validateTaskRows(
  rows: readonly Record<string, string>[],
  mapping: Record<string, string>,
): ImportOutcome<TaskImportRow> {
  const valid: TaskImportRow[] = []
  const errors: RowError[] = []

  rows.forEach((row, index) => {
    // +2: one for the header, one because spreadsheets count from 1.
    const lineNumber = index + 2
    const problems: string[] = []

    const title = field(row, mapping, 'title')
    if (!title) problems.push('Title is required')
    if (title.length > 300) problems.push('Title is longer than 300 characters')

    const status = parseChoice(field(row, mapping, 'status'), TASK_STATUSES, 'todo')
    if (!status.ok) problems.push(status.reason)

    const priority = parseChoice(field(row, mapping, 'priority'), PRIORITIES, 'medium')
    if (!priority.ok) problems.push(priority.reason)

    const startDate = parseImportDate(field(row, mapping, 'start_date'))
    if (!startDate.ok) problems.push(`Start date: ${startDate.reason}`)

    const dueDate = parseImportDate(field(row, mapping, 'due_date'))
    if (!dueDate.ok) problems.push(`Due date: ${dueDate.reason}`)

    const hoursRaw = field(row, mapping, 'estimated_hours')
    let hours: number | null = null
    if (hoursRaw) {
      const parsed = Number(hoursRaw.replace(',', '.'))
      if (!Number.isFinite(parsed) || parsed < 0) {
        problems.push(`Estimated hours: "${hoursRaw}" is not a number`)
      } else {
        hours = parsed
      }
    }

    if (problems.length > 0) {
      errors.push({ row: lineNumber, message: problems.join('; ') })
      return
    }

    valid.push({
      title,
      status: status.ok ? status.value : 'todo',
      priority: priority.ok ? priority.value : 'medium',
      assignee_email: field(row, mapping, 'assignee_email').toLowerCase() || null,
      start_date: startDate.ok ? startDate.value : null,
      due_date: dueDate.ok ? dueDate.value : null,
      estimated_hours: hours,
    })
  })

  return { valid, errors }
}

const CONTACT_TYPES = ['client', 'vendor', 'both'] as const

export function validateContactRows(
  rows: readonly Record<string, string>[],
  mapping: Record<string, string>,
): ImportOutcome<ContactImportRow> {
  const valid: ContactImportRow[] = []
  const errors: RowError[] = []

  rows.forEach((row, index) => {
    const lineNumber = index + 2
    const problems: string[] = []

    const name = field(row, mapping, 'contact_name')
    if (!name) problems.push('Contact name is required')

    const type = parseChoice(field(row, mapping, 'type'), CONTACT_TYPES, 'client')
    if (!type.ok) problems.push(type.reason)

    const email = field(row, mapping, 'email')
    // Deliberately loose: this is a contact record, not a login, and refusing an
    // unusual-but-real address would block a legitimate import.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      problems.push(`"${email}" is not an email address`)
    }

    if (problems.length > 0) {
      errors.push({ row: lineNumber, message: problems.join('; ') })
      return
    }

    const street = field(row, mapping, 'street')
    const city = field(row, mapping, 'city')
    const country = field(row, mapping, 'country')
    const hasAddress = Boolean(street || city || country)

    valid.push({
      contact_name: name,
      company_name: field(row, mapping, 'company_name') || null,
      type: type.ok ? type.value : 'client',
      email: email || null,
      phone: field(row, mapping, 'phone') || null,
      tax_id: field(row, mapping, 'tax_id') || null,
      notes: field(row, mapping, 'notes') || null,
      // An address of three empty strings is noise; store null instead.
      address: hasAddress
        ? {
            ...(street ? { street } : {}),
            ...(city ? { city } : {}),
            ...(country ? { country } : {}),
          }
        : null,
    })
  })

  return { valid, errors }
}
