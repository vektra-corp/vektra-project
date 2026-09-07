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
import { signOut } from '@/app/(auth)/actions'
import { ThemeToggle } from './theme-toggle'

/**
 * Sidebar footer identity block.
 *
 * The design's row: a 24px gradient avatar, the name at 12px, the role beneath
 * it in mono, and the theme toggle pushed to the end as a 26px bordered square.
 * The name opens the account menu; the toggle is its own control so switching
 * theme never costs a menu round trip.
 *
 * Sign-out posts to a server action inside a form rather than calling it from
 * an onClick, so it still works if hydration has not finished.
 */
export function SidebarUser({
  orgSlug,
  orgRole,
  profile,
}: {
  orgSlug: string
  orgRole: string
  profile: { full_name: string; avatar_url: string | null }
}) {
  return (
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
              {orgRole}
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
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild variant="destructive">
            <form action={signOut}>
              <button type="submit" className="w-full text-start">
                Sign out
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ThemeToggle />
    </div>
  )
}
