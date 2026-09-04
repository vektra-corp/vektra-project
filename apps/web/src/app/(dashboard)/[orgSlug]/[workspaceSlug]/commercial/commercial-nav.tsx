'use client'

import { SegmentedGroup, segmentedItemClass } from '@pm/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Section switcher across the five document types plus contacts. */
export function CommercialNav({ base }: { base: string }) {
  const pathname = usePathname()

  const tabs = [
    { segment: 'quotations', label: 'Quotations' },
    { segment: 'invoices', label: 'Invoices' },
    { segment: 'sales-orders', label: 'Sales orders' },
    { segment: 'purchase-orders', label: 'Purchase orders' },
    { segment: 'bills', label: 'Bills' },
    { segment: 'contacts', label: 'Contacts' },
  ]

  return (
    <SegmentedGroup aria-label="Commercial sections">
      {tabs.map((tab) => {
        const href = `${base}/${tab.segment}`
        return (
          <Link
            key={tab.segment}
            href={href}
            aria-current={pathname.startsWith(href) ? 'page' : undefined}
            className={segmentedItemClass({ active: pathname.startsWith(href) })}
          >
            {tab.label}
          </Link>
        )
      })}
    </SegmentedGroup>
  )
}
