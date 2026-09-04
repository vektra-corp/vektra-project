'use client'

import { SegmentedGroup, cn, segmentedItemClass } from '@pm/ui'
import { CalendarRange, Columns3, FileText, Table2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Project view switcher.
 *
 * Every view listed here has a route. If one is added before its page exists,
 * mark it `ready: false` — it then renders inert rather than linking into a
 * 404, which is worse than a tab that says "not yet".
 */
const VIEWS = [
  { segment: 'board', label: 'Board', icon: Columns3, ready: true },
  { segment: 'list', label: 'List', icon: Table2, ready: true },
  { segment: 'timeline', label: 'Timeline', icon: CalendarRange, ready: true },
  { segment: 'documents', label: 'Documents', icon: FileText, ready: true },
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
