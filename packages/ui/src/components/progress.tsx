import * as React from 'react'
import { cn } from '../utils'

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number
  max?: number
  /** Tailwind class for the filled portion; defaults to the brand gradient. */
  indicatorClassName?: string
}

/**
 * Determinate progress bar — the sprint points meter in the board toolbar.
 *
 * Built on plain elements rather than Radix because the only behaviour needed is
 * the ARIA contract, and a bar this small should not pull in a primitive.
 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, indicatorClassName, ...props }, ref) => {
    const safeMax = max > 0 ? max : 1
    const pct = Math.min(100, Math.max(0, (value / safeMax) * 100))

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        className={cn('bg-track h-1 w-full overflow-hidden rounded-full', className)}
        {...props}
      >
        <div
          className={cn(
            'from-brand-from to-brand-to h-full rounded-full bg-gradient-to-r transition-[width] duration-300',
            indicatorClassName,
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  },
)
Progress.displayName = 'Progress'

export { Progress }
