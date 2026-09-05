import * as React from 'react'
import { cn } from '../utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'border-input bg-card flex h-9 w-full rounded-md border px-3 py-1 text-ui transition-colors',
        'file:border-0 file:bg-transparent file:text-ui file:font-medium',
        'placeholder:text-faint',
        'focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/60',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
