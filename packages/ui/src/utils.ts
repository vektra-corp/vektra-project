import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names, with later Tailwind utilities winning over earlier ones of
 * the same kind. `cn('p-2', 'p-4')` yields 'p-4' rather than both.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
