import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { cn } from '../utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        /*
         * The solid action. On dark this is near-white on near-black, not the
         * teal accent: teal carries state (live, on track, in progress), so
         * spending it on every "New project" would drain it of meaning.
         */
        default: 'bg-btn text-btn-ink font-semibold hover:bg-btn/90',
        /* Teal fill, for the one place an action *is* the accent. */
        accent: 'bg-primary text-primary-foreground font-semibold hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90',
        secondary: 'bg-chip text-foreground hover:bg-surface-hover',
        /* The default chrome button: hairline outline, no fill. */
        subtle: 'border border-input text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        outline:
          'border border-input bg-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        ghost: 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        /* "+ Add issue" at the foot of a Kanban column. */
        dashed:
          'border border-dashed border-border text-faint hover:border-input hover:bg-chip hover:text-muted-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 rounded-sm px-1.5 text-meta',
        sm: 'h-7 px-2.5 text-ui',
        default: 'h-8 px-3 text-ui',
        lg: 'h-10 px-5 text-base',
        icon: 'h-8 w-8',
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
