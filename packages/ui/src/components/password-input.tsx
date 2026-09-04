'use client'

import { Eye, EyeOff } from 'lucide-react'
import * as React from 'react'
import { cn } from '../utils'
import { Button } from './button'
import { Input, type InputProps } from './input'

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /**
   * Accessible name for the toggle while the password is hidden. Passed in by
   * the app so it can be translated — this package has no locale context.
   */
  showLabel?: string
  /** Accessible name for the toggle while the password is revealed. */
  hideLabel?: string
}

/**
 * Password field with a reveal toggle.
 *
 * Toggling swaps the `type` on the same DOM node, so the value survives and the
 * field still submits under its `name`. The state is never lifted out of this
 * component: a revealed password stays revealed only for as long as the person
 * holds it open on this input.
 */
const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, showLabel = 'Show password', hideLabel = 'Hide password', disabled, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false)
    const Icon = visible ? EyeOff : Eye

    return (
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          disabled={disabled}
          className={cn('pe-9', className)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          aria-controls={props.id}
          className="absolute end-1 top-1/2 -translate-y-1/2 text-faint hover:bg-transparent"
        >
          <Icon className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    )
  },
)
PasswordInput.displayName = 'PasswordInput'

export { PasswordInput }
