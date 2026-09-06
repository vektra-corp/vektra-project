'use client'

import { SegmentedGroup } from '@pm/ui'
import { usePathname } from 'next/navigation'
import { SegmentedNavLink } from '@/components/layout/nav-link'

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
            <SegmentedNavLink key={tab.segment} href={href} active={pathname === href}>
              {tab.label}
            </SegmentedNavLink>
          )
        })}
      </SegmentedGroup>
    </div>
  )
}
