/**
 * Shared vocabulary for the two dashboards.
 *
 * Kept out of the page files so the global and per-organization views cannot
 * drift into labelling the same status differently — the fastest way to make an
 * operator distrust both.
 */

/**
 * Status colours are RESERVED — they are not categorical slots and must never be
 * reused for "series 4". Each one also ships with its text label everywhere it
 * appears, so state is never communicated by colour alone.
 */
export const STATUS_COLOR: Record<string, string> = {
  active: '#199e70', // good
  trial: '#3987e5', // informational
  suspended: '#c98500', // warning
  banned: '#e66767', // critical
  churned: '#6b7280', // neutral / ended
}

/** Countries seen in billing_country. Extended as markets are added. */
export const COUNTRY_LABEL: Record<string, string> = {
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  AE: 'United Arab Emirates',
  SG: 'Singapore',
  AU: 'Australia',
  CA: 'Canada',
  DE: 'Germany',
  FR: 'France',
  NL: 'Netherlands',
}

/** `2026-09-11T…` or `2026-09-11` → `2026-09`. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/** `2026-09` → `Sep 26`. */
export function monthLabel(key: string): string {
  const [year = '', month = ''] = key.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(month) - 1] ?? month} ${year.slice(2)}`
}

/**
 * The last `n` calendar months, oldest first, each with its UTC start instant.
 *
 * Built in UTC deliberately: payments are stored in UTC and a month boundary
 * computed in the operator's local zone would move a payment between months
 * depending on who is looking at the dashboard.
 */
export function lastMonths(n: number): { key: string; start: string }[] {
  const now = new Date()
  const out: { key: string; start: string }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      start: d.toISOString(),
    })
  }
  return out
}
