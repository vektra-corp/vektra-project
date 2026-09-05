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
import { Bell, LogOut, Settings, User } from 'lucide-react'
import Link from 'next/link'
import { signOut } from '@/app/(auth)/actions'
import { ThemeToggle } from './theme-toggle'

/**
 * Sidebar footer identity block.
 *
 * Sign-out posts to a server action inside a form rather than calling it from
 * an onClick, so it still works if hydration has not finished.
 */
export function UserMenu({
  orgSlug,
  orgRole,
  profile,
}: {
  orgSlug: string
  orgRole: string
  profile: { full_name: string; avatar_url: string | null }
}) {
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger className="hover:bg-surface-hover focus-visible:ring-ring/60 flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2">
          <Avatar className="h-7 w-7">
            {profile.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
            <AvatarFallback className="from-brand-from to-brand-to bg-gradient-to-br text-[10px] font-semibold text-white">
              {initials(profile.full_name || '?')}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-medium leading-tight">{profile.full_name}</p>
            <p className="label-meta-sm text-faint truncate pt-1">{orgRole}</p>
          </div>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel>{profile.full_name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/${orgSlug}/settings/profile`}>
              <User aria-hidden />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/${orgSlug}/notifications`}>
              <Bell aria-hidden />
              Notifications
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/${orgSlug}/settings`}>
              <Settings aria-hidden />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild variant="destructive">
            <form action={signOut}>
              <button type="submit" className="flex w-full items-center gap-2">
                <LogOut aria-hidden />
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
