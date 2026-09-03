import { format, formatDistanceToNow, type Locale as DateFnsLocale } from 'date-fns'
import { ar, de, enUS, es, fr, hi, ja, pt, zhCN } from 'date-fns/locale'
import { formatInTimeZone, toZonedTime } from 'date-fns-tz'
import {
  DEFAULT_FORMAT_OPTIONS,
  type DateFormat,
  type FormatOptions,
  type TimeFormat,
} from '../constants/locales'

const DATE_FNS_LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  es,
  fr,
  de,
  pt,
  ar,
  ja,
  zh: zhCN,
  hi,
}

const DATE_PATTERNS: Record<DateFormat, string> = {
  'DD/MM/YYYY': 'dd/MM/yyyy',
  'MM/DD/YYYY': 'MM/dd/yyyy',
  'YYYY-MM-DD': 'yyyy-MM-dd',
  'DD.MM.YYYY': 'dd.MM.yyyy',
  'DD-MM-YYYY': 'dd-MM-yyyy',
}

const TIME_PATTERNS: Record<TimeFormat, string> = {
  '12h': 'hh:mm a',
  '24h': 'HH:mm',
}

function localeFor(locale: string): DateFnsLocale {
  return DATE_FNS_LOCALES[locale] ?? enUS
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * RULE (§21.4): never call `.toLocaleDateString()` directly anywhere in the app.
 * All date rendering goes through these functions so format and timezone stay
 * consistent and user-configurable.
 */
export function formatDate(
  date: Date | string | number,
  options: Pick<FormatOptions, 'locale' | 'dateFormat'>,
): string {
  return format(toDate(date), DATE_PATTERNS[options.dateFormat], {
    locale: localeFor(options.locale),
  })
}

export function formatTime(
  date: Date | string | number,
  options: Pick<FormatOptions, 'locale' | 'timeFormat'>,
): string {
  return format(toDate(date), TIME_PATTERNS[options.timeFormat], {
    locale: localeFor(options.locale),
  })
}

export function formatDateTime(
  date: Date | string | number,
  options: Pick<FormatOptions, 'locale' | 'dateFormat' | 'timeFormat'>,
): string {
  return `${formatDate(date, options)} ${formatTime(date, options)}`
}

/**
 * Render a UTC timestamp in the viewer's timezone.
 * All timestamps are stored UTC (§21.6) — this is the only correct way to display them.
 */
export function formatInUserTimezone(
  date: Date | string | number,
  options: Pick<FormatOptions, 'locale' | 'dateFormat' | 'timeFormat' | 'timezone'>,
): string {
  const pattern = `${DATE_PATTERNS[options.dateFormat]} ${TIME_PATTERNS[options.timeFormat]}`
  return formatInTimeZone(toDate(date), options.timezone, pattern, {
    locale: localeFor(options.locale),
  })
}

export function formatRelativeTime(date: Date | string | number, locale: string): string {
  return formatDistanceToNow(toDate(date), { addSuffix: true, locale: localeFor(locale) })
}

export function formatCurrency(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

export function formatPercent(value: number, locale: string, fractionDigits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/** Human-readable file size. Used for attachment lists and storage quota UI. */
export function formatFileSize(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = unitIndex === 0 ? 0 : 1
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)
  return `${formatted} ${units[unitIndex]}`
}

/** Minutes → "7h 30m", for timesheet totals. */
export function formatDuration(minutes: number, locale: string): string {
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  const nf = new Intl.NumberFormat(locale)
  if (hours === 0) return `${nf.format(mins)}m`
  if (mins === 0) return `${nf.format(hours)}h`
  return `${nf.format(hours)}h ${nf.format(mins)}m`
}

/**
 * "End of day" in the ORG timezone, for overdue comparisons (§21.6).
 * A task due 2026-03-01 is overdue only after 23:59:59 on that date locally.
 */
export function isOverdue(dueDate: string | null, timezone: string, now: Date = new Date()): boolean {
  if (!dueDate) return false
  const nowLocal = toZonedTime(now, timezone)
  const todayLocal = format(nowLocal, 'yyyy-MM-dd')
  return dueDate < todayLocal
}

export const defaultFormatOptions: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS }
