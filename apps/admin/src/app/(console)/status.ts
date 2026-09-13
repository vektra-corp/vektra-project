/**
 * Statuses an operator may set, and what each means to a tenant.
 *
 * Not in `actions.ts`: that module is 'use server' and may only export async
 * functions.
 */
export const SETTABLE_STATUS = {
  active: 'Full access.',
  trial: 'Trial access.',
  suspended: 'Blocked, reversible — normally a billing problem.',
  banned: 'Blocked for cause.',
  churned: 'Ended. Not blocked, but no longer a customer.',
} as const

export type SettableStatus = keyof typeof SETTABLE_STATUS
