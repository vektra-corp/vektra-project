/**
 * Pure formatting helpers for charts.
 *
 * Deliberately NOT in `charts.tsx`. That file carries 'use client', and every
 * export of a client module — functions included — reaches a server component
 * as a client *reference* rather than the function itself. Importing `compact`
 * from there into a server page threw
 * "TypeError: (0 , charts__WEBPACK_IMPORTED_MODULE__.compact) is not a function"
 * at render time, which typecheck cannot catch because the types are identical.
 *
 * Keeping them here lets both sides import the same implementation.
 */

/** Categorical slots, in fixed order. Never cycled — a 9th series folds into "Other". */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'] as const

/** Money in minor units → a short major-unit label. */
export function shortMoney(minor: number, currency: string): string {
  const major = minor / 100
  const sign = major < 0 ? '-' : ''
  const n = Math.abs(major)
  const unit =
    n >= 1_00_00_000
      ? [n / 1_00_00_000, 'Cr']
      : n >= 1_00_000
        ? [n / 1_00_000, 'L']
        : n >= 1_000
          ? [n / 1_000, 'K']
          : [n, '']
  const [value, suffix] = unit as [number, string]
  return `${sign}${currency} ${value.toFixed(suffix ? 1 : 0)}${suffix}`
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
