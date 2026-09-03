import type { OrgRole } from '@pm/shared/constants'
import { cn } from '@pm/ui'
import { BarChart3, FolderKanban, LayoutDashboard, Settings, Users } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

interface Workspace {
  id: string
  name: string
  slug: string
  color: string | null
  icon: string | null
}

/**
 * Primary navigation.
 *
 * Items are filtered by role here for a tidy UI, but that is presentation only —
 * every destination re-checks permission server-side, because hiding a link is
 * not access control.
 */
export async function Sidebar({
  orgSlug,
  orgName,
  orgRole,
  workspaces,
}: {
  orgSlug: string
  orgName: string
  orgRole: OrgRole
  workspaces: Workspace[]
}) {
  const t = await getTranslations('nav')

  const items = [
    { href: `/${orgSlug}/dashboard`, label: t('dashboard'), icon: LayoutDashboard, minRole: null },
    { href: `/${orgSlug}/reports`, label: t('reports'), icon: BarChart3, minRole: null },
    { href: `/${orgSlug}/members`, label: t('members'), icon: Users, minRole: 'manager' },
    { href: `/${orgSlug}/settings`, label: t('settings'), icon: Settings, minRole: 'admin' },
  ] as const

  const rank: Record<OrgRole, number> = { owner: 4, admin: 3, manager: 2, member: 1 }
  const visible = items.filter(
    (item) => !item.minRole || rank[orgRole] >= rank[item.minRole as OrgRole],
  )

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-e bg-background md:flex">
      <div className="flex h-14 items-center border-b px-4">
        <span className="truncate font-semibold">{orgName}</span>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto p-3">
        <ul className="space-y-1">
          {visible.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div>
          <h2 className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('workspaces')}
          </h2>
          <ul className="space-y-1">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  href={`/${orgSlug}/${workspace.slug}/projects`}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <span
                    className={cn('h-2 w-2 shrink-0 rounded-full bg-primary')}
                    style={workspace.color ? { backgroundColor: workspace.color } : undefined}
                    aria-hidden
                  />
                  <span className="truncate">{workspace.name}</span>
                </Link>
              </li>
            ))}
            {workspaces.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                <FolderKanban className="mb-1 h-4 w-4" aria-hidden />
                No workspaces yet
              </li>
            ) : null}
          </ul>
        </div>
      </nav>
    </aside>
  )
}
