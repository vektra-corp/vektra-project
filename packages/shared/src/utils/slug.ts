/** URL-safe slug generation for org and workspace slugs. */

/** Unicode combining diacritical marks, stripped after NFKD normalization. */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g')

/** Slugs that would collide with app routes or be confusing as a tenant name. */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'billing',
  'blog',
  'dashboard',
  'docs',
  'help',
  'login',
  'logout',
  'new',
  // No longer a route — kept reserved so an org cannot take a slug that
  // historical links still point at.
  'portal',
  'pricing',
  'privacy',
  'settings',
  'signup',
  'status',
  'support',
  'terms',
  'www',
  'verify',
  'forgot-password',
])

/**
 * Convert arbitrary text to a lowercase, hyphenated slug.
 * Unicode is normalized and diacritics stripped so "Cafe Munchen" reads cleanly
 * regardless of the input script.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}

/**
 * A slug is 2-48 characters, lowercase alphanumeric with internal hyphens, and
 * not reserved. The minimum of 2 matches both `orgSlugSchema` and the CHECK
 * constraint on organizations.slug — all three layers must agree or a value
 * accepted by one is rejected by another.
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$/.test(slug) && !RESERVED_SLUGS.has(slug)
}

/**
 * Produce a slug that does not collide with `taken`, appending -2, -3, ...
 * Callers pass the set of existing slugs in the relevant scope.
 */
export function uniqueSlug(input: string, taken: Iterable<string>): string {
  const base = slugify(input) || 'untitled'
  const existing = new Set(taken)
  if (!existing.has(base) && !RESERVED_SLUGS.has(base)) return base

  let suffix = 2
  let candidate = `${base}-${suffix}`
  while (existing.has(candidate) || RESERVED_SLUGS.has(candidate)) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }
  return candidate
}

/**
 * Derive a starting project key from a name — the ATL in ATL-241.
 *
 * Only a suggestion: the key is a stored, editable column (migration 00034),
 * and this is what a new project gets before anyone changes it. The output has
 * to satisfy the same CHECK the column carries — two to ten characters,
 * starting with a letter — so leading digits are dropped ("3M Rollout" would
 * otherwise yield the illegal "3MR") and anything left too short falls back to
 * PRJ rather than being padded into a word nobody chose.
 *
 * Takes the first word rather than initials so "Atlas Migration" reads as ATL,
 * which is what people say out loud, and falls back to the first letters of
 * later words when the first word is too short to stand alone.
 */
export function projectKey(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)

  if (words.length === 0) return 'PRJ'

  const first = words[0]!
  const candidate = first.length >= 3 ? first.slice(0, 3) : words.join('').slice(0, 3)

  // A key must begin with a letter, so a numeric prefix is dropped rather than
  // carried into a value the database would reject.
  const legal = candidate.replace(/^[0-9]+/, '')

  return legal.length >= 2 ? legal : 'PRJ'
}
