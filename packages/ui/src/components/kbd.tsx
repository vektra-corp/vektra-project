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
        'border-border bg-surface-raised inline-flex h-[18px] min-w-[22px] items-center justify-center rounded border px-1.5',
        'text-faint font-mono text-[10px] font-medium leading-none tracking-wider',
        className,
      )}
      {...props}
    />
  ),
)
Kbd.displayName = 'Kbd'

export { Kbd }
