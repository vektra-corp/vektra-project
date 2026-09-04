'use client'

import { SegmentedGroup, segmentedItemClass } from '@pm/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface SettingsTab {
  segment: string
  label: string
}

/** Sub-navigation for the settings section. Tabs are filtered by role upstream. */
export function SettingsNav({ orgSlug, tabs }: { orgSlug: string; tabs: SettingsTab[] }) {
  const pathname = usePathname()

  return (
    <div className="px-5 py-3">
      <SegmentedGroup aria-label="Settings sections">
        {tabs.map((tab) => {
          const href = `/${orgSlug}/settings/${tab.segment}`
          return (
            <Link
              key={tab.segment}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              className={segmentedItemClass({ active: pathname === href })}
            >
              {tab.label}
            </Link>
          )
        })}
      </SegmentedGroup>
    </div>
  )
}
