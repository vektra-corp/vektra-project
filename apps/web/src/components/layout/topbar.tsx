import { AvatarStack, Kbd, type StackedPerson } from '@pm/ui'
import { Search } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export interface Crumb {
  label: string
  href?: string
}

/**
 * Section header: breadcrumb and context on the left, global actions on the right.
 *
 * Rendered by the innermost layout that knows its own breadcrumb rather than by
 * the org shell, because only that layout has the names — the org shell would
 * have to re-derive them from the URL. It resolves its own member list so a page
 * only has to supply the breadcrumb.
 */
export async function Topbar({
  orgSlug,
  breadcrumb,
  meta,
}: {
  orgSlug: string
  breadcrumb: Crumb[]
  /** Context chip beside the breadcrumb, e.g. the sprint badge. */
  meta?: ReactNode
}) {
  const auth = await requireAuthPage(orgSlug)
  const supabase = createClient()

  const { data: members } = await supabase
    .from('org_members')
    .select('user_id, profile:profiles!org_members_user_id_fkey(id, full_name, avatar_url)')
    .eq('organization_id', auth.orgId)
    .limit(12)

  const people: StackedPerson[] = (members ?? [])
    .map((row) => (Array.isArray(row.profile) ? row.profile[0] : row.profile))
    .filter((profile): profile is { id: string; full_name: string; avatar_url: string | null } =>
      Boolean(profile),
    )
    .map((profile) => ({ id: profile.id, name: profile.full_name, avatarUrl: profile.avatar_url }))

  return (
    <header className="border-border flex h-[52px] shrink-0 items-center justify-between gap-4 border-b px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          {breadcrumb.map((crumb, index) => {
            const last = index === breadcrumb.length - 1
            return (
              <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                {index > 0 ? (
                  <span className="text-subtle shrink-0 text-nav" aria-hidden>/</span>
                ) : null}
                {crumb.href && !last ? (
                  <Link
                    href={crumb.href}
                    className="text-faint hover:text-foreground truncate text-base transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={
                      last
                        ? 'text-foreground truncate text-base font-semibold'
                        : 'text-faint truncate text-base'
                    }
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            )
          })}
        </nav>
        {meta}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Link
          href={`/${orgSlug}/search`}
          className="border-input text-faint hover:text-foreground flex items-center gap-[7px] rounded-md border px-2.5 py-[5px] text-nav transition-colors"
        >
          <Search className="h-3 w-3" aria-hidden />
          Search
          <Kbd className="ms-1 border-0 px-0">⌘K</Kbd>
        </Link>
        {people.length > 0 ? <AvatarStack people={people} max={2} /> : null}
      </div>
    </header>
  )
}
