'use client'

import { SegmentedGroup, segmentedItemClass } from '@pm/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function TeamNav({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname()
  const tabs = [
    { href: `/${orgSlug}/team`, label: 'Directory' },
    { href: `/${orgSlug}/team/leave`, label: 'Leave' },
  ]

  return (
    <SegmentedGroup aria-label="Team sections">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? 'page' : undefined}
          className={segmentedItemClass({ active: pathname === tab.href })}
        >
          {tab.label}
        </Link>
      ))}
    </SegmentedGroup>
  )
}
