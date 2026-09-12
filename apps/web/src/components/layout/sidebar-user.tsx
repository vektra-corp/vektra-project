'use client'

import { initials } from '@pm/shared/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@pm/ui'
import Link from 'next/link'
import { useState } from 'react'
import { signOut } from '@/app/(auth)/actions'
import { UpgradeDialog } from '@/components/billing/upgrade-dialog'
import { ThemeToggle } from './theme-toggle'

/**
 * Sidebar footer identity block.
 *
 * The design's row: a 24px gradient avatar, the name at 12px, the role beneath
 * it in mono, and the theme toggle pushed to the end as a 26px bordered square.
 * The name opens the account menu; the toggle is its own control so switching
 * theme never costs a menu round trip.
 *
 * The meta line carries the org role AND the current plan, because "which plan
 * am I on" is a question people ask from wherever they happen to be, not from
 * the billing page. When the org is on a trial or has fallen back to the free
 * tier, an Upgrade control appears directly beneath the row — close to the
 * plan it refers to, rather than buried in settings.
 *
 * Sign-out calls the server action from onSelect rather than submitting a
 * <form>. A form cannot work here: Radix unmounts the menu as soon as an item
 * is selected, so the form is disconnected before its submit event dispatches
 * and the action never runs (the browser logs "Form submission canceled
 * because the form is not connected"). The menu needs hydration to open at
 * all, so nothing is lost by not using a form.
 */
export function SidebarUser({
  orgSlug,
  orgRole,
  profile,
  planLabel,
  showUpgrade,
  locale,
}: {
  orgSlug: string
  orgRole: string
  profile: { full_name: string; avatar_url: string | null }
  /** Short plan name for the meta line, e.g. "Growth" or "Trial". */
  planLabel: string
  /** True on a trial or the free fallback — the states worth offering a plan from. */
  showUpgrade: boolean
  locale: string
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-[9px] px-2.5 py-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger className="focus-visible:ring-ring/60 -mx-1 flex min-w-0 flex-1 items-center gap-[9px] rounded-md px-1 py-0.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2">
          <Avatar className="h-6 w-6 shrink-0">
            {profile.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
            <AvatarFallback className="from-brand-from to-brand-to bg-gradient-to-br text-[10px] font-semibold text-[#04120F]">
              {initials(profile.full_name || '?')}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-nav leading-tight">{profile.full_name}</span>
            <span className="text-faint truncate pt-0.5 font-mono text-meta uppercase leading-none">
              {orgRole} · {planLabel}
            </span>
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel>{profile.full_name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/${orgSlug}/settings/profile`}>Profile</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/${orgSlug}/notifications`}>Notifications</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/${orgSlug}/settings`}>Settings</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/${orgSlug}/settings/billing`}>Plan &amp; billing</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="cursor-pointer"
            onSelect={() => {
              void signOut()
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

        <ThemeToggle />
      </div>

      {showUpgrade ? (
        <button
          type="button"
          onClick={() => setUpgradeOpen(true)}
          className="text-nav focus-visible:ring-ring/60 mx-2.5 mb-1.5 rounded-md border border-border px-2 py-1 text-center transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2"
        >
          Upgrade plan
        </button>
      ) : null}

      {/* Mounted only once an upgrade is actually on offer, so the options
          query never runs for an organization already paying. */}
      {showUpgrade ? (
        <UpgradeDialog
          orgSlug={orgSlug}
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
          locale={locale}
        />
      ) : null}
    </div>
  )
}
