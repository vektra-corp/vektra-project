import { cn } from '@pm/ui'

/**
 * The Vektra V.
 *
 * Two overlapping strokes: a teal arm falling right, a purple arm falling left,
 * and — where they cross at the vertex — the navy their overlap produces. The
 * navy is a real third shape rather than a blend mode so the mark renders the
 * same on any ground, dark or light, and survives being flattened into a PDF.
 *
 * Geometry is derived once here and shared by both fills, so the arms stay in
 * register at every size. Drawn inline rather than shipped as an asset so it
 * stays crisp at any density and can be tinted by the caller.
 */

/** Left arm: outer edge (0,0)→vertex, inner edge parallel from (13.5,0). */
const TEAL = 'M0 0 H13.5 L24 15.75 L30.75 25.875 L26.5 32.26 A3 3 0 0 1 21.5 32.26 Z'
/** Right arm: mirror of the left. */
const PURPLE = 'M34.5 0 H48 L26.5 32.26 A3 3 0 0 1 21.5 32.26 L17.25 25.875 L24 15.75 Z'
/** The overlap: a kite from the inner vertex down to the rounded tip. */
const NAVY = 'M24 15.75 L30.75 25.875 L26.5 32.26 A3 3 0 0 1 21.5 32.26 L17.25 25.875 Z'

export function BrandLogo({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 48 34"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id="vektra-teal" x1="0" y1="0" x2="0.45" y2="1">
          <stop offset="0%" stopColor="#3ED9B6" />
          <stop offset="100%" stopColor="#22B49B" />
        </linearGradient>
        <linearGradient id="vektra-purple" x1="1" y1="0" x2="0.55" y2="1">
          <stop offset="0%" stopColor="#9B30F0" />
          <stop offset="100%" stopColor="#7C1FD6" />
        </linearGradient>
      </defs>
      <path d={TEAL} fill="url(#vektra-teal)" />
      <path d={PURPLE} fill="url(#vektra-purple)" />
      <path d={NAVY} fill="#1D3E78" />
    </svg>
  )
}

/** The mark alone, sized for a nav row. */
export function BrandMark({ className }: { className?: string }) {
  return <BrandLogo className={cn('h-5 w-[28px] shrink-0', className)} />
}

/**
 * Mark plus wordmark, for signed-out surfaces where the product has to name
 * itself. The wordmark is set in the app's own type rather than as artwork so
 * it inherits weight and tracking from the running design.
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandLogo className="h-6 w-[34px] shrink-0" title="Vektra" />
      <span className="text-foreground text-[17px] font-semibold tracking-[0.14em]">VEKTRA</span>
    </span>
  )
}
