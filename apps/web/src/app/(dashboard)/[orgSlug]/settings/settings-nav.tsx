'use client'

import { cn } from '@pm/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePendingNav } from '@/hooks/use-pending-nav'

export interface SettingsTab {
  segment: string
  label: string
}

/**
 * Sub-navigation for the settings section.
 *
 * A 214px rail down the left rather than a row of tabs: the section has a dozen
 * pages, and a horizontal strip either wraps onto two lines or scrolls sideways,
 * both of which hide destinations. The rail shows all of them at once and gives
 * each a full-width hit target. Tabs are filtered by role upstream.
 */
export function SettingsNav({ orgSlug, tabs }: { orgSlug: string; tabs: SettingsTab[] }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Settings sections"
      className="border-border bg-surface scrollbar-slim hidden w-[214px] shrink-0 flex-col gap-[3px] overflow-y-auto border-e px-3 py-4 md:flex"
    >
      <h2 className="label-meta-lg text-subtle px-2.5 pb-2">Org settings</h2>
      {tabs.map((tab) => (
        <SettingsNavLink
          key={tab.segment}
          href={`/${orgSlug}/settings/${tab.segment}`}
          label={tab.label}
          active={pathname === `/${orgSlug}/settings/${tab.segment}`}
        />
      ))}
    </nav>
  )
}

/**
 * One rail row.
 *
 * A component rather than a hook call inside the map, because the pending flag
 * has to be per-row: one `usePendingNav()` at the nav level would be shared by
 * every row, so clicking one would light them all.
 */
function SettingsNavLink({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  const { pending, onNavigate } = usePendingNav()

  return (
    <Link
      href={href}
      onClick={onNavigate(href)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-[7px] px-[11px] py-2 text-base transition-colors',
        active || pending
          ? 'bg-surface-hover text-foreground font-medium'
          : 'text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground',
      )}
    >
      {label}
    </Link>
  )
}
