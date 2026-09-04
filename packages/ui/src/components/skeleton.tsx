import type * as React from 'react'
import { cn } from '../utils'

/** Placeholder block for async sections (§23.2 rule 4: never a blank space). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-surface-hover animate-pulse rounded-md', className)} {...props} />
}

export { Skeleton }
