'use client'

import { cn } from '@pm/ui'
import { useId, useState } from 'react'
import { SERIES, compact, shortMoney } from './chart-format'

/**
 * Console charts.
 *
 * Hand-rolled SVG rather than a charting library, for two reasons. The console's
 * CSP forbids 'unsafe-eval' (next.config.mjs), and the shapes needed here are a
 * bar, a stack and a line — a 50KB dependency to draw three rectangles would be
 * the wrong trade in an internal tool.
 *
 * The categorical palette below is the dataviz reference palette's dark column,
 * validated against THIS console's surface (#0C0F14) rather than assumed:
 * lightness band, chroma floor, CVD separation (worst adjacent ΔE 8.4), the
 * normal-vision floor (worst adjacent ΔE 19.3) and 3:1 contrast all pass.
 * Re-run the validator before changing a hue — the ordering is what passes, so
 * swapping two slots is not a cosmetic edit.
 *
 * Single-measure charts (a bar list of counts) deliberately use ONE hue, the
 * product's primary. Colour there would encode nothing: the category is already
 * named on the axis, and repeating it in hue is the most common way a chart
 * ends up saying less than the table it replaced.
 */

/* ========================================================================== */
/* Stat tile — a headline number. No plot, so no hover layer.                 */
/* ========================================================================== */

export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad' | 'neutral'
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <p className="label-meta text-faint">{label}</p>
      <p
        className={cn(
          'pt-2.5 text-xl font-semibold tabular-nums',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {sub ? <p className="text-muted-foreground pt-1 text-xs">{sub}</p> : null}
    </div>
  )
}

/* ========================================================================== */
/* Bar list — magnitude across named categories. One hue, direct labels.      */
/* ========================================================================== */

export interface BarDatum {
  label: string
  value: number
  /** Rendered instead of the raw value when present (e.g. a money string). */
  display?: string
}

export function BarList({
  title,
  data,
  empty = 'No data yet.',
}: {
  title: string
  data: BarDatum[]
  empty?: string
}) {
  const max = Math.max(1, ...data.map((d) => d.value))

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <h2 className="text-[13px] font-medium">{title}</h2>

      {data.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-xs">{empty}</p>
      ) : (
        <ul className="space-y-2.5 pt-3.5">
          {data.map((d) => (
            <li key={d.label}>
              <div className="flex items-baseline justify-between gap-3 pb-1">
                <span className="truncate text-xs">{d.label}</span>
                {/* Direct label: the value is on the row, so no axis is needed. */}
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {d.display ?? compact(d.value)}
                </span>
              </div>
              {/* Track + fill. 4px radius on the data end, anchored at the baseline. */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(1.5, (d.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ========================================================================== */
/* Composition bar — one stacked bar + legend. Categorical, so hues carry ID.  */
/* ========================================================================== */

export interface Segment {
  label: string
  value: number
  /** Overrides the categorical slot — used for status, which has reserved colours. */
  color?: string
}

export function CompositionBar({
  title,
  segments,
  total,
}: {
  title: string
  segments: Segment[]
  total?: number
}) {
  const sum = total ?? segments.reduce((acc, s) => acc + s.value, 0)
  const shown = segments.filter((s) => s.value > 0)

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-medium">{title}</h2>
        <span className="text-muted-foreground text-xs tabular-nums">{compact(sum)}</span>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-xs">No data yet.</p>
      ) : (
        <>
          {/* 2px gaps between segments so adjacent fills never touch. */}
          <div className="flex h-2 gap-0.5 pt-3.5">
            {shown.map((s, i) => (
              <div
                key={s.label}
                title={`${s.label}: ${s.value}`}
                className="h-full rounded-full first:rounded-s-full last:rounded-e-full"
                style={{
                  width: `${(s.value / Math.max(1, sum)) * 100}%`,
                  background: s.color ?? SERIES[i % SERIES.length],
                }}
              />
            ))}
          </div>

          {/* Legend is always present for >= 2 series, so identity is never colour alone. */}
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3">
            {shown.map((s, i) => (
              <li key={s.label} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: s.color ?? SERIES[i % SERIES.length] }}
                />
                <span className="text-muted-foreground text-xs">{s.label}</span>
                <span className="text-faint text-xs tabular-nums">{s.value}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/* ========================================================================== */
/* Trend — two money series over time. One axis (both are money).             */
/* ========================================================================== */

export interface TrendPoint {
  label: string
  a: number
  b: number
}

export function TrendChart({
  title,
  points,
  currency,
  aLabel,
  bLabel,
}: {
  title: string
  points: TrendPoint[]
  currency: string
  aLabel: string
  bLabel: string
}) {
  const uid = useId()
  const [hover, setHover] = useState<number | null>(null)

  /*
   * The viewBox aspect ratio IS the rendered height: the svg is w-full, so a
   * 560x150 box scaled to a ~1200px container came out 320px tall — a mostly
   * empty plot for twelve points. A wide box keeps the trend readable without
   * the card turning into whitespace.
   */
  const W = 1120
  const H = 180
  const PAD_X = 10
  const PAD_Y = 16

  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]))
  const step = points.length > 1 ? (W - PAD_X * 2) / (points.length - 1) : 0
  const x = (i: number) => PAD_X + i * step
  const y = (v: number) => H - PAD_Y - (v / max) * (H - PAD_Y * 2)

  const path = (key: 'a' | 'b') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ')

  const active = hover === null ? null : points[hover]

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-medium">{title}</h2>
        {/* Legend — two series, so it is never optional. */}
        <ul className="flex gap-4">
          {[
            { label: aLabel, color: SERIES[2] },
            { label: bLabel, color: SERIES[1] },
          ].map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-muted-foreground text-xs">{s.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {points.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-xs">No data yet.</p>
      ) : (
        <div className="relative pt-3">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={`${title}. ${aLabel} and ${bLabel} by month.`}
            onMouseLeave={() => setHover(null)}
          >
            {/* Recessive baseline. No gridlines: the tooltip carries exact values. */}
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={H - PAD_Y}
              y2={H - PAD_Y}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />

            <path d={path('a')} fill="none" stroke={SERIES[2]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={path('b')} fill="none" stroke={SERIES[1]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {hover !== null ? (
              <>
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={PAD_Y}
                  y2={H - PAD_Y}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={1}
                />
                {/* 2px surface ring so an overlapping marker stays readable. */}
                <circle cx={x(hover)} cy={y(active?.a ?? 0)} r={4} fill={SERIES[2]} stroke="#0C0F14" strokeWidth={2} />
                <circle cx={x(hover)} cy={y(active?.b ?? 0)} r={4} fill={SERIES[1]} stroke="#0C0F14" strokeWidth={2} />
              </>
            ) : null}

            {/* Hit targets, wider than the marks. */}
            {points.map((p, i) => (
              <rect
                key={`${uid}-${p.label}`}
                x={x(i) - step / 2}
                y={0}
                width={Math.max(step, 12)}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            ))}
          </svg>

          <div className="flex justify-between pt-1.5">
            <span className="text-faint text-[10px]">{points[0]?.label}</span>
            <span className="text-faint text-[10px]">{points[points.length - 1]?.label}</span>
          </div>

          {active ? (
            <div className="border-border bg-surface-overlay pointer-events-none absolute end-2 top-2 rounded-md border px-2.5 py-1.5 shadow-card">
              <p className="label-meta text-faint">{active.label}</p>
              <p className="pt-1 text-xs tabular-nums">
                <span className="text-muted-foreground">{aLabel} </span>
                {shortMoney(active.a, currency)}
              </p>
              <p className="text-xs tabular-nums">
                <span className="text-muted-foreground">{bLabel} </span>
                {shortMoney(active.b, currency)}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
