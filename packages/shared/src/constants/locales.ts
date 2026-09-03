/** Supported locales and formatting defaults (claude.md §21). */

export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'ar', 'ja', 'zh', 'hi'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  ar: 'العربية',
  ja: '日本語',
  zh: '中文',
  hi: 'हिन्दी',
}

/** Locales rendered right-to-left. */
export const RTL_LOCALES = ['ar', 'he', 'fa', 'ur'] as const

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return (RTL_LOCALES as readonly string[]).includes(locale) ? 'rtl' : 'ltr'
}

export const DATE_FORMATS = [
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'YYYY-MM-DD',
  'DD.MM.YYYY',
  'DD-MM-YYYY',
] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const TIME_FORMATS = ['12h', '24h'] as const
export type TimeFormat = (typeof TIME_FORMATS)[number]

export const DEFAULT_FORMAT_OPTIONS = {
  locale: DEFAULT_LOCALE,
  dateFormat: 'YYYY-MM-DD' as DateFormat,
  timeFormat: '24h' as TimeFormat,
  timezone: 'UTC',
  currency: 'USD',
} as const

export interface FormatOptions {
  locale: string
  dateFormat: DateFormat
  timeFormat: TimeFormat
  timezone: string
  currency: string
}
