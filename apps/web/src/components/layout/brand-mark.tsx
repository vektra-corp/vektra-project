import { cn } from '@pm/ui'

/**
 * The Vektra mark: a gradient tile carrying the wordmark's opening stroke.
 *
 * Drawn as inline SVG rather than an image so it inherits the brand gradient
 * tokens and stays crisp at every density without shipping an asset.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'from-brand-from to-brand-to shadow-card flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <path
          d="M5 6.5 L12 18 L19 6.5"
          stroke="white"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
