import { addDays, differenceInCalendarDays, format, startOfMonth, startOfWeek } from 'date-fns'

/**
 * Time scale for the Gantt.
 *
 * All arithmetic is on calendar dates, never timestamps: `due_date` is a DATE
 * with no timezone, so converting it to a Date and back would shift the bar by
 * a day for anyone west of UTC (§21.6). Dates enter and leave as `yyyy-MM-dd`.
 */

export type Zoom = 'day' | 'week' | 'month'

export const COLUMN_WIDTH: Record<Zoom, number> = {
  day: 32,
  week: 14,
  month: 5,
}

export const ROW_HEIGHT = 32

export interface Tick {
  /** Offset in days from the chart's first day. */
  offset: number
  label: string
  /** Emphasised gridline — a month boundary, or a Monday at day zoom. */
  major: boolean
}

/** Parse `yyyy-MM-dd` as a local calendar date, avoiding UTC drift. */
export function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

export function toDateString(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function dayOffset(from: Date, date: string): number {
  return differenceInCalendarDays(parseDate(date), from)
}

/**
 * The window the chart covers.
 *
 * Padded on both sides so a bar never starts flush against the edge, and given
 * a floor so a project with one single-day task still renders a usable scale.
 */
export function chartRange(
  dates: readonly string[],
  today: string,
): { start: Date; days: number } {
  // `today` is always present, so the list is never empty and the padding below
  // handles a project with no dated tasks on its own.
  const sorted = [...dates, today].filter(Boolean).sort()
  const first = parseDate(sorted[0]!)
  const last = parseDate(sorted[sorted.length - 1]!)

  const start = addDays(first, -3)
  const days = Math.max(30, differenceInCalendarDays(last, start) + 7)
  return { start, days }
}

/** Header ticks for the given zoom. */
export function ticksFor(start: Date, days: number, zoom: Zoom): Tick[] {
  const ticks: Tick[] = []

  if (zoom === 'day') {
    for (let offset = 0; offset < days; offset += 1) {
      const date = addDays(start, offset)
      ticks.push({
        offset,
        label: format(date, 'd'),
        // Weeks start on Monday, matching the ISO convention the rest of the
        // product uses for scheduling.
        major: date.getDay() === 1,
      })
    }
    return ticks
  }

  if (zoom === 'week') {
    let cursor = startOfWeek(start, { weekStartsOn: 1 })
    while (differenceInCalendarDays(cursor, start) < days) {
      const offset = differenceInCalendarDays(cursor, start)
      if (offset >= 0) {
        ticks.push({ offset, label: format(cursor, 'd MMM'), major: cursor.getDate() <= 7 })
      }
      cursor = addDays(cursor, 7)
    }
    return ticks
  }

  let cursor = startOfMonth(start)
  while (differenceInCalendarDays(cursor, start) < days) {
    const offset = differenceInCalendarDays(cursor, start)
    if (offset >= 0) {
      ticks.push({ offset, label: format(cursor, 'MMM yyyy'), major: true })
    }
    cursor = startOfMonth(addDays(cursor, 32))
  }
  return ticks
}

/** Month bands above the tick row, so a long chart stays readable at any zoom. */
export function monthBands(start: Date, days: number): { offset: number; span: number; label: string }[] {
  const bands: { offset: number; span: number; label: string }[] = []
  let cursor = start

  while (differenceInCalendarDays(cursor, start) < days) {
    const monthStart = startOfMonth(cursor)
    const nextMonth = startOfMonth(addDays(monthStart, 32))
    const from = Math.max(0, differenceInCalendarDays(cursor, start))
    const to = Math.min(days, differenceInCalendarDays(nextMonth, start))

    bands.push({ offset: from, span: to - from, label: format(monthStart, 'MMMM yyyy') })
    cursor = nextMonth
  }

  return bands
}
