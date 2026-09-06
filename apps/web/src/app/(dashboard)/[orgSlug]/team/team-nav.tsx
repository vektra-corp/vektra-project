'use client'

import { SegmentedGroup } from '@pm/ui'
import { usePathname } from 'next/navigation'
import { SegmentedNavLink } from '@/components/layout/nav-link'

export function TeamNav({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname()
  const tabs = [
    { href: `/${orgSlug}/team`, label: 'Directory' },
    { href: `/${orgSlug}/team/leave`, label: 'Leave' },
  ]

  return (
    <SegmentedGroup aria-label="Team sections">
      {tabs.map((tab) => (
        <SegmentedNavLink key={tab.href} href={tab.href} active={pathname === tab.href}>
          {tab.label}
        </SegmentedNavLink>
      ))}
    </SegmentedGroup>
  )
}
