'use client'

import { SegmentedGroup } from '@pm/ui'
import { usePathname } from 'next/navigation'
import { SegmentedNavLink } from '@/components/layout/nav-link'

/** Section switcher: quotations and contacts, the two that remain. */
export function CommercialNav({ base }: { base: string }) {
  const pathname = usePathname()

  const tabs = [
    { segment: 'quotations', label: 'Quotations' },
    { segment: 'contacts', label: 'Contacts' },
  ]

  return (
    <SegmentedGroup aria-label="Commercial sections">
      {tabs.map((tab) => {
        const href = `${base}/${tab.segment}`
        return (
          <SegmentedNavLink key={tab.segment} href={href} active={pathname.startsWith(href)}>
            {tab.label}
          </SegmentedNavLink>
        )
      })}
    </SegmentedGroup>
  )
}
