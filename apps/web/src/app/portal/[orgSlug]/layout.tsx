import { initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, Badge, Button } from '@pm/ui'
import { LogOut } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { signOut } from '@/app/(auth)/actions'
import { BrandMark } from '@/components/layout/brand-mark'
import { requirePortal } from '@/lib/auth/portal'

export const metadata: Metadata = {
  title: { default: 'Portal', template: '%s · Portal' },
  robots: { index: false, follow: false },
}

/**
 * External portal shell.
 *
 * Deliberately no sidebar (§4): a portal user sees only the projects explicitly
 * shared with them, so a navigation tree of things they cannot open would be
 * noise at best and a disclosure at worst.
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { orgSlug: string }
}) {
  const portal = await requirePortal(params.orgSlug)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-5">
        <Link href={`/portal/${portal.orgSlug}`} className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-[13px] font-semibold">{portal.orgName}</span>
        </Link>

        <Badge variant="outline" shape="meta">
          Guest access
        </Badge>

        <div className="ms-auto flex items-center gap-3">
          <div className="hidden text-end sm:block">
            <p className="text-[13px] font-medium leading-tight">{portal.fullName}</p>
            <p className="label-meta-sm pt-1 text-faint">{portal.email}</p>
          </div>
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-surface-hover text-[10px] font-medium uppercase text-muted-foreground">
              {initials(portal.fullName)}
            </AvatarFallback>
          </Avatar>
          <form action={signOut}>
            <Button type="submit" variant="subtle" size="icon-sm" aria-label="Sign out">
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-6">{children}</main>

      <footer className="border-t border-border-subtle px-5 py-3">
        <p className="label-meta text-center text-faint">
          You are viewing shared work only. Internal notes are not shown here.
        </p>
      </footer>
    </div>
  )
}
