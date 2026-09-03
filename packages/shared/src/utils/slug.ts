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
