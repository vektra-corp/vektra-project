import type { WidgetCategory } from '@pm/shared/constants'
import { cn } from '@pm/ui'
import Link from 'next/link'
import { Widget, WidgetKpi } from './widget'

/**
 * A single headline figure.
 *
 * A stat tile, not a chart: the job here is "one magnitude, read at a glance",
 * and a plot would add ink without adding information. It shares the ordinary
 * widget chrome so a KPI sitting next to a chart reads as the same kind of
 * object, and only the body differs.
 *
 * Tone is carried by the caption as well as by colour, so the state survives
 * greyscale and colour-vision deficiency.
 */
export interface StatTileProps {
  label: string
  value: number
  category?: WidgetCategory
  href?: string
  /** Reserved status states. `default` is the neutral, non-alarming case. */
  tone?: 'default' | 'warning' | 'critical'
  caption?: string
}

const TONES = {
  default: 'text-foreground',
  warning: 'text-warning',
  critical: 'text-destructive',
} as const

export function StatTile({
  label,
  value,
  category,
  href,
  tone = 'default',
  caption,
}: StatTileProps) {
  // A zero count is never alarming, whatever the tile's configured tone.
  const valueClass = value === 0 ? TONES.default : TONES[tone]

  const tile = (
    <Widget title={label} category={category} className={cn(href && 'hover:border-input')}>
      <WidgetKpi value={value} note={caption} valueClassName={valueClass} />
    </Widget>
  )

  return href ? (
    <Link href={href} className="block h-full">
      {tile}
    </Link>
  ) : (
    tile
  )
}
