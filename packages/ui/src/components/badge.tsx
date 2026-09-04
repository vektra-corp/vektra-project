import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '../utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap border transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-surface-hover text-muted-foreground',
        destructive: 'border-transparent bg-destructive/15 text-destructive',
        success: 'border-transparent bg-success/15 text-success',
        warning: 'border-transparent bg-warning/15 text-warning',
        outline: 'border-border text-muted-foreground',
      },
      /* The Vektra chrome uses tracked monospace caps for every status chip;
       * `pill` is the rounded sans form used for labels and plan names. */
      shape: {
        meta: 'label-meta rounded px-1.5 py-1',
        pill: 'rounded-full px-2.5 py-0.5 text-xs font-medium',
      },
    },
    defaultVariants: { variant: 'default', shape: 'pill' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, shape, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, shape }), className)} {...props} />
}

export { Badge, badgeVariants }
