import { cn } from '@pm/ui'
import Image from 'next/image'

/**
 * The Vektra Project mark.
 *
 * Shipped as an image rather than inline SVG: the mark is built from
 * overlapping translucent gradients, and every hand-traced SVG of it loses the
 * blend where the strokes cross. The source art is 2000px square with a lot of
 * empty canvas — the file here is pre-trimmed to the ink, so a 20px nav icon
 * renders the mark at 20px rather than at half that inside its own padding.
 *
 * This is the PRODUCT mark. The corporate V belongs to the admin console, which
 * has its own copy — the two apps must not look like each other at a glance.
 */
export function BrandLogo({
  className,
  size = 28,
  title,
}: {
  className?: string
  size?: number
  title?: string
}) {
  return (
    <Image
      src="/brand/vektra-project-mark.png"
      alt={title ?? ''}
      width={size}
      height={size}
      className={cn('object-contain', className)}
      priority
      aria-hidden={title ? undefined : true}
    />
  )
}

/** The mark alone, sized for a nav row. */
export function BrandMark({ className }: { className?: string }) {
  return <BrandLogo size={24} className={cn('h-6 w-6 shrink-0', className)} />
}

/**
 * Mark plus wordmark, for signed-out surfaces where the product has to name
 * itself. The wordmark is set in the app's own type rather than as artwork so
 * it inherits weight and tracking from the running design.
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandLogo size={30} className="h-[30px] w-[30px] shrink-0" title="Vektra Project" />
      <span className="text-foreground text-[15px] font-semibold tracking-[0.02em]">
        Vektra Project
      </span>
    </span>
  )
}
