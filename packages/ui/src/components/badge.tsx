import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '../utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap border transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-chip text-muted-foreground',
        destructive: 'border-transparent bg-destructive/15 text-destructive',
        success: 'border-transparent bg-success/15 text-success',
        warning: 'border-transparent bg-warning/15 text-warning',
        outline: 'border-input text-muted-foreground',
        /* Carries its colour from the caller (priority, status, health). */
        bare: 'border-transparent bg-chip',
        /* Teal on a chip fill inside a hairline — the topbar's sprint marker. */
        accent: 'border-input bg-chip text-primary',
      },
      /*
       * Three shapes, all from the design:
       *  meta  — tracked monospace caps, for section and column labels
       *  chip  — the 11.5px status tag on cards and table rows
       *  pill  — the rounded sans form used for labels and plan names
       *  id    — 9.5px monospace at 0.08em, for a sprint or document marker
       */
      shape: {
        meta: 'label-meta rounded-sm px-1.5 py-1',
        chip: 'rounded-sm px-2 py-[3px] text-micro font-medium',
        pill: 'rounded-full px-2.5 py-0.5 text-micro font-medium',
        id: 'rounded-[4px] px-1.5 py-[3px] font-mono text-id uppercase tracking-[0.08em]',
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
