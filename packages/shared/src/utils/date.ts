import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfWeek,
  isWeekend,
  parseISO,
  startOfWeek,
} from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'

/**
 * Date helpers for scheduling, leave duration, and reporting windows.
 *
 * RULE (§21.6): timestamps are stored UTC. `date` columns (due_date, start_date,
 * leave dates) are calendar dates with no timezone — they are compared as
 * `yyyy-MM-dd` strings, never converted.
 */

/** Format a Date as the `yyyy-MM-dd` string used by Postgres `date` columns. */
export function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Today's calendar date in a given timezone, as `yyyy-MM-dd`. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return toDateString(toZonedTime(now, timezone))
}

/** Convert a wall-clock time in a timezone to the UTC instant to store. */
export function zonedToUtc(localDateTime: string, timezone: string): Date {
  return fromZonedTime(localDateTime, timezone)
}

export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from))
}

/** Monday-start week bounds, as date strings. Used for timesheet periods. */
export function weekBounds(date: Date | string): { start: string; end: string } {
  const d = typeof date === 'string' ? parseISO(date) : date
  return {
    start: toDateString(startOfWeek(d, { weekStartsOn: 1 })),
    end: toDateString(endOfWeek(d, { weekStartsOn: 1 })),
  }
}

/**
 * Working days in a range, excluding weekends and the supplied public holidays.
 * Drives leave-request duration so a Fri–Mon request costs 2 days, not 4 (§19.5).
 */
export function workingDaysBetween(
  startDate: string,
  endDate: string,
  options: {
    /** ISO weekday numbers that count as work days. 1 = Monday … 7 = Sunday. */
    workDays?: readonly number[]
    /** `yyyy-MM-dd` dates to exclude. */
    holidays?: readonly string[]
  } = {},
): number {
  const workDays = options.workDays ?? [1, 2, 3, 4, 5]
  const holidays = new Set(options.holidays ?? [])

  const days = eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) })

  return days.filter((day) => {
    const isoWeekday = day.getDay() === 0 ? 7 : day.getDay()
    if (!workDays.includes(isoWeekday)) return false
    return !holidays.has(toDateString(day))
  }).length
}

/** True when the date falls on a Saturday or Sunday. */
export function isWeekendDay(date: string): boolean {
  return isWeekend(parseISO(date))
}

/** Add calendar days to a date string, e.g. for dependency lag (§6.2). */
export function addDaysToDateString(date: string, days: number): string {
  return toDateString(addDays(parseISO(date), days))
}

export type RelativeRange =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_quarter'
  | 'this_year'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'

/** Resolve a saved-report / dashboard-widget range into concrete dates. */
export function resolveRange(
  range: RelativeRange,
  timezone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const local = toZonedTime(now, timezone)
  const today = toDateString(local)

  switch (range) {
    case 'today':
      return { from: today, to: today }
    case 'this_week': {
      const bounds = weekBounds(local)
      return { from: bounds.start, to: bounds.end }
    }
    case 'this_month': {
      const first = new Date(local.getFullYear(), local.getMonth(), 1)
      const last = new Date(local.getFullYear(), local.getMonth() + 1, 0)
      return { from: toDateString(first), to: toDateString(last) }
    }
    case 'this_quarter': {
      const quarter = Math.floor(local.getMonth() / 3)
      const first = new Date(local.getFullYear(), quarter * 3, 1)
      const last = new Date(local.getFullYear(), quarter * 3 + 3, 0)
      return { from: toDateString(first), to: toDateString(last) }
    }
    case 'this_year':
      return {
        from: toDateString(new Date(local.getFullYear(), 0, 1)),
        to: toDateString(new Date(local.getFullYear(), 11, 31)),
      }
    case 'last_7_days':
      return { from: toDateString(addDays(local, -6)), to: today }
    case 'last_30_days':
      return { from: toDateString(addDays(local, -29)), to: today }
    case 'last_90_days':
      return { from: toDateString(addDays(local, -89)), to: today }
  }
}
