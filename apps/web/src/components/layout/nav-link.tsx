'use client'

import { cn, segmentedItemClass } from '@pm/ui'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { usePendingNav } from '@/hooks/use-pending-nav'

/**
 * A tab in a `SegmentedGroup` that acknowledges its own click.
 *
 * This is a component rather than a hook call inside each nav's `.map()` because
 * the pending flag has to be per-tab. One `usePendingNav()` at the nav level
 * would be shared by every tab in it, so clicking one would light them all.
 *
 * A pending tab is styled as active. The old tab is still on screen at that
 * point, so for a moment two look selected — which is the honest depiction:
 * one is where you are, the other is where you are going.
 */
export function SegmentedNavLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}) {
  const { pending, onNavigate } = usePendingNav()

  return (
    <Link
      href={href}
      onClick={onNavigate(href)}
      aria-current={active ? 'page' : undefined}
      className={cn(segmentedItemClass({ active: active || pending }), pending && 'animate-pulse')}
    >
      {children}
    </Link>
  )
}
