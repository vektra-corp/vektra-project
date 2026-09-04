import type { OrgRole } from '@pm/shared/constants'
import { Kbd, Separator } from '@pm/ui'
import {
  CalendarRange,
  CircleDot,
  Contact,
  FileSignature,
  Columns3,
  FileText,
  Files,
  Gauge,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Layers,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Split,
  Table2,
  Timer,
  Users,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { BrandMark } from './brand-mark'
import { SidebarItem, SidebarProjectGroup, SidebarSection, type NavItem } from './sidebar-nav'
import { UserMenu } from './user-menu'

/** Project views with a route today; the rest render as "soon". */
const ROUTED_PROJECT_VIEWS = ['board', 'list', 'timeline', 'documents']

export interface SidebarWorkspace {
  id: string
  name: string
  slug: string
  color: string | null
}

export interface SidebarProjectSummary {
  id: string
  name: string
  workspace_slug: string
  color: string | null
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
  projects,
  profile,
  inboxCount,
  myTaskCount,
}: {
  orgSlug: string
  orgName: string
  orgRole: OrgRole
  workspaces: SidebarWorkspace[]
  projects: SidebarProjectSummary[]
  profile: { id: string; full_name: string; avatar_url: string | null }
  inboxCount: number
  myTaskCount: number
}) {
  const t = await getTranslations('nav')
  const rank: Record<OrgRole, number> = { owner: 4, admin: 3, manager: 2, member: 1 }
  const atLeast = (role: OrgRole) => rank[orgRole] >= rank[role]

  const primary: NavItem[] = [
    {
      key: 'dashboard',
      label: t('dashboard'),
      icon: LayoutDashboard,
      href: `/${orgSlug}/dashboard`,
    },
    {
      key: 'inbox',
      label: t('inbox'),
      icon: Inbox,
      href: `/${orgSlug}/notifications`,
      count: inboxCount,
    },
    {
      key: 'my-tasks',
      label: t('myTasks'),
      icon: CircleDot,
      href: `/${orgSlug}/my-tasks`,
      count: myTaskCount,
    },
  ]

  // Views the project layout actually serves. Backlog planning and workload are
  // later phases, so they render as unavailable rather than as links into a 404.
  const projectViews = (): NavItem[] => [
    { key: 'board', label: t('board'), icon: Columns3 },
    { key: 'list', label: t('list'), icon: Table2 },
    { key: 'timeline', label: t('timeline'), icon: CalendarRange },
    { key: 'planning', label: t('planning'), icon: Layers },
    { key: 'documents', label: t('documents'), icon: FileText },
    { key: 'workload', label: t('workload'), icon: Gauge },
  ]

  // Commercial lives inside a workspace, so its links need one. The first
  // workspace is the sensible default; a member with none sees them inert.
  const commercialBase = workspaces[0]
    ? `/${orgSlug}/${workspaces[0].slug}/commercial`
    : null
  const commercialHref = (segment: string) =>
    commercialBase && atLeast('manager') ? `${commercialBase}/${segment}` : undefined

  const commercial: NavItem[] = [
    { key: 'quotations', label: t('quotations'), icon: FileSignature, href: commercialHref('quotations') },
    { key: 'invoices', label: t('invoices'), icon: Receipt, href: commercialHref('invoices') },
    { key: 'sales-orders', label: t('salesOrders'), icon: ScrollText, href: commercialHref('sales-orders') },
    { key: 'purchase-orders', label: t('purchaseOrders'), icon: ShoppingCart, href: commercialHref('purchase-orders') },
    { key: 'bills', label: t('bills'), icon: Wallet, href: commercialHref('bills') },
    { key: 'contacts', label: t('contacts'), icon: Contact, href: commercialHref('contacts') },
  ]

  const projectsByWorkspace = workspaces.map((workspace) => ({
    workspace,
    projects: projects.filter((project) => project.workspace_slug === workspace.slug),
  }))

  return (
    <aside className="border-border-subtle bg-surface hidden w-64 shrink-0 flex-col border-e md:flex">
      <div className="flex items-center gap-2.5 px-3 py-3">
        <BrandMark />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight">{orgName}</p>
          <p className="label-meta-sm text-faint truncate pt-1">{t('workspaceCaption')}</p>
        </div>
      </div>

      <div className="px-3 pb-1">
        <Link
          href={`/${orgSlug}/search`}
          className="border-border-subtle bg-surface-raised text-faint hover:border-border hover:text-muted-foreground flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[13px] transition-colors"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="m10.5 10.5 3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="flex-1 text-start">{t('jumpTo')}</span>
          <Kbd>⌘K</Kbd>
        </Link>
      </div>

      <nav className="scrollbar-slim flex-1 overflow-y-auto px-2 pb-4" aria-label="Primary">
        <ul className="space-y-px pt-2">
          {primary.map((item) => (
            <SidebarItem key={item.key} item={item} />
          ))}
        </ul>

        {projectsByWorkspace.map(({ workspace, projects: wsProjects }) => (
          <SidebarSection key={workspace.id} title={`${t('work')} · ${workspace.name}`} collapsible>
            <SidebarItem
              item={{
                key: `${workspace.id}-projects`,
                label: t('projects'),
                icon: Columns3,
                href: `/${orgSlug}/${workspace.slug}/projects`,
                count: wsProjects.length,
                exact: true,
              }}
            />
            {wsProjects.map((project) => (
              <SidebarProjectGroup
                key={project.id}
                orgSlug={orgSlug}
                project={{
                  id: project.id,
                  name: project.name,
                  workspaceSlug: project.workspace_slug,
                  color: project.color,
                }}
                views={projectViews().map((view) =>
                  ROUTED_PROJECT_VIEWS.includes(view.key)
                    ? {
                        ...view,
                        href: `/${orgSlug}/${project.workspace_slug}/projects/${project.id}/${view.key}`,
                      }
                    : view,
                )}
              />
            ))}
            <SidebarItem
              item={{ key: `${workspace.id}-workflows`, label: t('workflows'), icon: Split }}
            />
          </SidebarSection>
        ))}

        {workspaces.length === 0 ? (
          <SidebarSection title={t('work')}>
            <li className="text-faint px-2.5 py-2 text-[13px]">{t('noWorkspaces')}</li>
          </SidebarSection>
        ) : null}

        <SidebarSection title={t('commercial')}>
          {commercial.map((item) => (
            <SidebarItem key={item.key} item={item} />
          ))}
        </SidebarSection>

        <SidebarSection title={t('people')}>
          <SidebarItem
            item={{
              key: 'team',
              label: t('team'),
              icon: Users,
              href: `/${orgSlug}/team`,
              exact: true,
            }}
          />
          <SidebarItem
            item={{ key: 'leave', label: t('leave'), icon: CalendarRange, href: `/${orgSlug}/team/leave` }}
          />
          <SidebarItem
            item={{
              key: 'timesheets',
              label: t('timesheets'),
              icon: Timer,
              href: `/${orgSlug}/timesheets`,
            }}
          />
          {atLeast('manager') ? (
            <SidebarItem
              item={{ key: 'members', label: t('members'), icon: Users, href: `/${orgSlug}/members` }}
            />
          ) : null}
        </SidebarSection>

        {atLeast('manager') ? (
          <SidebarSection title={t('insights')}>
            <SidebarItem
              item={{
                key: 'reports',
                label: t('reports'),
                icon: ListTodo,
                href: `/${orgSlug}/reports`,
              }}
            />
            <SidebarItem item={{ key: 'docs', label: t('documents'), icon: Files }} />
          </SidebarSection>
        ) : null}
      </nav>

      <div className="mt-auto px-2 pb-2">
        <Separator className="mb-2" />
        {atLeast('admin') ? (
          <ul className="space-y-px pb-1">
            <SidebarItem
              item={{
                key: 'settings',
                label: t('settings'),
                icon: Settings,
                href: `/${orgSlug}/settings`,
              }}
            />
          </ul>
        ) : null}

        <UserMenu orgSlug={orgSlug} orgRole={orgRole} profile={profile} />
      </div>
    </aside>
  )
}
