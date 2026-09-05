import * as React from 'react'
import { cn } from '../utils'

/**
 * Keyboard shortcut hint, as seen on the sidebar search and the topbar search
 * button. Renders the literal keys; callers pass "⌘K" rather than a key list so
 * the platform-specific modifier is decided once, at the call site.
 */
const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        'border-input inline-flex items-center justify-center rounded-[4px] border px-1 py-0.5',
        'text-subtle font-mono text-id font-normal leading-none',
        className,
      )}
      {...props}
    />
  ),
)
Kbd.displayName = 'Kbd'

export { Kbd }
