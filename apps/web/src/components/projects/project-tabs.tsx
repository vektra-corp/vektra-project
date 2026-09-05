'use client'

import { SegmentedGroup, cn, segmentedItemClass } from '@pm/ui'
import { CalendarRange, Columns3, Gauge, Layers, Table2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Project view switcher.
 *
 * The set and its order are the design's: List, Board, Timeline, Planning,
 * Workload. Documents and Settings are deliberately absent — they reach the
 * project from the sidebar, not from the view switcher, because they are not
 * views OF the task set the way the other five are.
 *
 * Every view listed here has a route. If one is added before its page exists,
 * mark it `ready: false` — it then renders inert rather than linking into a
 * 404, which is worse than a tab that says "not yet".
 */
const VIEWS = [
  { segment: 'list', label: 'List', icon: Table2, ready: true },
  { segment: 'board', label: 'Board', icon: Columns3, ready: true },
  { segment: 'timeline', label: 'Timeline', icon: CalendarRange, ready: true },
  { segment: 'planning', label: 'Planning', icon: Layers, ready: true },
  { segment: 'workload', label: 'Workload', icon: Gauge, ready: true },
] as const

export function ProjectViewTabs({ base }: { base: string }) {
  const pathname = usePathname()

  return (
    <SegmentedGroup aria-label="Project views">
      {VIEWS.map((view) => {
        const href = `${base}/${view.segment}`
        const active = pathname === href || pathname.startsWith(`${href}/`)

        if (!view.ready) {
          return (
            <span
              key={view.segment}
              aria-disabled
              title={`${view.label} arrives in a later phase`}
              className={cn(
                segmentedItemClass({ active: false }),
                'text-faint/70 hover:text-faint/70 cursor-default',
              )}
            >
              {view.label}
            </span>
          )
        }

        return (
          <Link
            key={view.segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={segmentedItemClass({ active })}
          >
            {view.label}
          </Link>
        )
      })}
    </SegmentedGroup>
  )
}
