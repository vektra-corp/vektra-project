import * as React from 'react'
import { cn } from '../utils'

/**
 * A hairline rule. Decorative by default: a separator that only groups things
 * visually should not be announced, so it is hidden from assistive tech unless
 * `decorative` is turned off.
 */
const Separator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    orientation?: 'horizontal' | 'vertical'
    decorative?: boolean
  }
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <div
    ref={ref}
    role={decorative ? 'none' : 'separator'}
    aria-orientation={decorative ? undefined : orientation}
    className={cn(
      'bg-border-subtle shrink-0',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
))
Separator.displayName = 'Separator'

export { Separator }
