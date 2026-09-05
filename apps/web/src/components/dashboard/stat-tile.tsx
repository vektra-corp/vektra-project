import { cn } from '@pm/ui'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'

/**
 * A single headline figure.
 *
 * A stat tile, not a chart: the job here is "one magnitude, read at a glance",
 * and a plot would add ink without adding information. Tone is carried by an
 * icon and a label as well as colour, so the state survives greyscale and
 * colour-vision deficiency.
 */
export interface StatTileProps {
  label: string
  value: number
  icon: LucideIcon
  href?: string
  /** Reserved status states. `default` is the neutral, non-alarming case. */
  tone?: 'default' | 'warning' | 'critical'
  caption?: string
}

const TONES = {
  default: { icon: 'text-faint', value: 'text-foreground' },
  warning: { icon: 'text-warning', value: 'text-warning' },
  critical: { icon: 'text-destructive', value: 'text-destructive' },
} as const

export function StatTile({
  label,
  value,
  icon: Icon,
  href,
  tone = 'default',
  caption,
}: StatTileProps) {
  const styles = TONES[tone]
  // A zero count is never alarming, whatever the tile's configured tone.
  const effective = value === 0 ? TONES.default : styles

  const body = (
    <>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5', effective.icon)} aria-hidden />
        <span className="text-faint truncate font-mono text-[11px]">{label}</span>
      </div>
      <p className={cn('pt-3 text-[26px] font-semibold leading-none tabular-nums', effective.value)}>
        {value}
      </p>
      {caption ? <p className="text-faint pt-2 text-ui">{caption}</p> : null}
    </>
  )

  const className = 'border-border bg-card block rounded-lg border p-4 transition-colors'

  return href ? (
    <Link href={href} className={cn(className, 'hover:border-input')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
