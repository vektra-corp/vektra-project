/**
 * Deliberately not `packages/shared`'s locale-aware `formatDuration` — this is
 * a compact "1h 30m" for the timesheet's own totals row and entry rows, not a
 * translated string.
 *
 * Lives outside entry-list.tsx (a 'use client' file) so a Server Component can
 * call it directly. Every export of a "use client" module — not only its
 * components — becomes a client reference when a Server Component imports it,
 * so `page.tsx` calling this while it lived there was calling a reference
 * object, not the function: "formatDuration is not a function" at render time,
 * with the definition sitting right there looking correct.
 */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
}
