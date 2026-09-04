'use client'

import { Check } from 'lucide-react'
import * as React from 'react'
import { cn } from '../utils'

export interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> {
  /** Circular styling, used for the completion toggle on task cards. */
  shape?: 'square' | 'circle'
  size?: 'sm' | 'default'
}

/**
 * Checkbox built on a real `input[type=checkbox]`.
 *
 * The native input stays in the DOM (visually hidden, not `display:none`) so it
 * keeps its keyboard behaviour, participates in form submission, and is read
 * correctly by assistive tech; the visible box is a sibling driven by `peer-*`.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, shape = 'square', size = 'default', ...props }, ref) => {
    const dim = size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'

    return (
      <span className={cn('relative inline-flex shrink-0', dim, className)}>
        <input
          ref={ref}
          type="checkbox"
          className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0"
          {...props}
        />
        <span
          aria-hidden
          className={cn(
            'border-input pointer-events-none flex items-center justify-center border text-transparent transition-colors',
            dim,
            shape === 'circle' ? 'rounded-full' : 'rounded-[5px]',
            'peer-hover:border-muted-foreground',
            'peer-checked:border-success peer-checked:bg-success peer-checked:text-background',
            'peer-focus-visible:ring-ring/60 peer-focus-visible:ring-2',
            'peer-disabled:opacity-50',
          )}
        >
          <Check className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={3} />
        </span>
      </span>
    )
  },
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
