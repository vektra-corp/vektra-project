/** Small display helpers that carry no locale or timezone dependency. */

/** "Arun Kumar Anandhan" -> "AK". Used for avatar fallbacks. */
export function initials(name: string, max = 2): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, max)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

/**
 * Human-readable task reference, e.g. "VEK-42" (claude.md §18 rule 1).
 *
 * Takes the project's stored `key` rather than deriving a prefix from its name:
 * the key is a real, editable column (migration 00034), so a reference stays
 * stable when the project is renamed and changes only when someone deliberately
 * changes the key.
 */
export function taskReference(projectKey: string, taskNumber: number): string {
  return `${projectKey || 'TSK'}-${taskNumber}`
}

/** snake_case or kebab-case to Title Case, for labels derived from enum values. */
export function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/** Clamp a number into a range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Fractional position for drag-and-drop ordering, so moving one card writes one
 * row instead of renumbering the whole column.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1000
  if (before === null) return (after as number) - 1000
  if (after === null) return before + 1000
  return (before + after) / 2
}
