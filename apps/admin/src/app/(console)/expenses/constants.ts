/**
 * Expense vocabulary.
 *
 * Separate from `actions.ts` because that file carries 'use server', and a
 * 'use server' module may only export async functions — a plain array exported
 * from it reaches the client as an unusable reference, failing at render with
 * "EXPENSE_CATEGORIES.map is not a function". Typecheck cannot see this: the
 * types are identical either way.
 */
export const EXPENSE_CATEGORIES = [
  'infrastructure',
  'gateway_fees',
  'salaries',
  'marketing',
  'software',
  'support',
  'other',
] as const

export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  infrastructure: 'Infrastructure',
  gateway_fees: 'Gateway fees',
  salaries: 'Salaries',
  marketing: 'Marketing',
  software: 'Software',
  support: 'Support',
  other: 'Other',
}
