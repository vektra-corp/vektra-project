import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { cn } from '../utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-surface-hover',
        /* The default chrome button on a dark surface: raised panel + hairline. */
        subtle: 'border border-border bg-surface-raised text-foreground hover:bg-surface-hover',
        outline:
          'border border-border bg-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        ghost: 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        /* "+ Add issue" at the foot of a Kanban column. */
        dashed:
          'border border-dashed border-border text-faint hover:border-input hover:bg-surface-raised/60 hover:text-muted-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 rounded px-1.5 text-xs',
        sm: 'h-7 px-2.5 text-[13px]',
        default: 'h-9 px-3.5 text-sm',
        lg: 'h-10 px-6 text-sm',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
        'icon-xs': 'h-6 w-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Shows a spinner and disables the button. */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
