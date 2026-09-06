import type { OrgRole } from '@pm/shared/constants'
import { Kbd, Separator } from '@pm/ui'
import { ChevronDown, Search } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { BrandMark } from './brand-mark'
import { SidebarItem, SidebarProjectGroup, SidebarSection, type NavItem } from './sidebar-nav'
import { UserMenu } from './user-menu'

/** Project views with a route today; the rest render as "soon". */
const ROUTED_PROJECT_VIEWS = [
  'list',
  'board',
  'timeline',
  'workload',
  'documents',
  'settings',
]

export interface SidebarWorkspace {
  id: string
  name: string
  slug: string
  color: string | null
}

export interface SidebarProjectSummary {
  /** The project's 16-digit public id: this list exists to build links. */
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
      icon: 'LayoutDashboard',
      href: `/${orgSlug}/dashboard`,
    },
    {
      key: 'inbox',
      label: t('inbox'),
      icon: 'Inbox',
      href: `/${orgSlug}/notifications`,
      count: inboxCount,
    },
    {
      key: 'my-tasks',
      label: t('myTasks'),
      icon: 'CircleDot',
      href: `/${orgSlug}/my-tasks`,
      count: myTaskCount,
    },
  ]

  // Views the project layout actually serves; anything not listed in
  // ROUTED_PROJECT_VIEWS renders as unavailable rather than as a link into a 404.
  // The design's sidebar order, which differs from the toolbar's: Documents and
  // Settings belong to the project, not to its task views, so they sit here.
  const projectViews = (): NavItem[] => [
    { key: 'list', label: t('list'), icon: 'Table2' },
    { key: 'board', label: t('board'), icon: 'Columns3' },
    { key: 'timeline', label: t('timeline'), icon: 'CalendarRange' },
    { key: 'workload', label: t('workload'), icon: 'Gauge' },
    { key: 'documents', label: t('documents'), icon: 'FileText' },
    { key: 'settings', label: t('settings'), icon: 'Settings' },
  ]

  // Commercial lives inside a workspace, so its links need one. The first
  // workspace is the sensible default; a member with none sees them inert.
  const commercialBase = workspaces[0]
    ? `/${orgSlug}/${workspaces[0].slug}/commercial`
    : null
  const commercialHref = (segment: string) =>
    commercialBase && atLeast('manager') ? `${commercialBase}/${segment}` : undefined

  const commercial: NavItem[] = [
    { key: 'quotations', label: t('quotations'), icon: 'FileSignature', href: commercialHref('quotations') },
    { key: 'contacts', label: t('contacts'), icon: 'Contact', href: commercialHref('contacts') },
    { key: 'templates', label: t('pdfTemplates'), icon: 'FileText', href: commercialHref('templates') },
  ]

  const projectsByWorkspace = workspaces.map((workspace) => ({
    workspace,
    projects: projects.filter((project) => project.workspace_slug === workspace.slug),
  }))

  return (
    <aside className="border-border bg-surface hidden w-[242px] shrink-0 flex-col border-e px-3 py-3.5 md:flex">
      {/* The product names itself here, not the tenant. Someone in three
          organizations was seeing three different sidebars and no way to tell
          at a glance which app they were in; the org name is what the caption
          is for, and it is still the link into org settings. */}
      <Link
        href={`/${orgSlug}/settings/general`}
        className="hover:bg-surface-hover/60 flex items-center gap-[9px] rounded-lg px-1.5 py-1 transition-colors"
      >
        <BrandMark />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold tracking-[0.02em] leading-tight">
            Vektra Project
          </p>
          <p className="label-meta text-faint truncate pt-1 tracking-[0.08em]">{orgName}</p>
        </div>
        <span
          className="border-input text-faint grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border text-[9px]"
          aria-hidden
        >
          <ChevronDown className="h-2.5 w-2.5" />
        </span>
      </Link>

      <div className="pt-[15px]">
        <Link
          href={`/${orgSlug}/search`}
          className="border-border bg-sunk text-faint hover:border-input hover:text-muted-foreground flex items-center gap-2 rounded-lg border px-2.5 py-[7px] text-nav transition-colors"
        >
          <Search className="h-3 w-3 shrink-0" aria-hidden />
          <span className="flex-1 text-start">{t('jumpTo')}</span>
          <Kbd>⌘K</Kbd>
        </Link>
      </div>

      <nav className="scrollbar-slim -mx-1 flex-1 overflow-y-auto px-1 pb-4" aria-label="Primary">
        <ul className="space-y-0.5 pt-[15px]">
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
                icon: 'Columns3',
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
              item={{
                key: `${workspace.id}-workflows`,
                label: t('workflows'),
                icon: 'Split',
                href: atLeast('manager')
                  ? `/${orgSlug}/${workspace.slug}/workflows`
                  : undefined,
              }}
            />
          </SidebarSection>
        ))}

        {workspaces.length === 0 ? (
          <SidebarSection title={t('work')}>
            <li className="text-faint px-2.5 py-2 text-base">{t('noWorkspaces')}</li>
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
              icon: 'Users',
              href: `/${orgSlug}/team`,
              exact: true,
            }}
          />
          <SidebarItem
            item={{ key: 'leave', label: t('leave'), icon: 'CalendarRange', href: `/${orgSlug}/team/leave` }}
          />
          <SidebarItem
            item={{
              key: 'timesheets',
              label: t('timesheets'),
              icon: 'Timer',
              href: `/${orgSlug}/timesheets`,
            }}
          />
          {atLeast('manager') ? (
            <SidebarItem
              item={{ key: 'members', label: t('members'), icon: 'Users', href: `/${orgSlug}/members` }}
            />
          ) : null}
        </SidebarSection>

        {atLeast('manager') ? (
          <SidebarSection title={t('insights')}>
            <SidebarItem
              item={{
                key: 'reports',
                label: t('reports'),
                icon: 'ListTodo',
                href: `/${orgSlug}/reports`,
              }}
            />
            <SidebarItem
              item={{
                key: 'revenue',
                label: t('revenue'),
                icon: 'TrendingUp',
                href: `/${orgSlug}/revenue`,
              }}
            />
            <SidebarItem item={{ key: 'docs', label: t('documents'), icon: 'Files' }} />
          </SidebarSection>
        ) : null}
      </nav>

      <div className="mt-auto pt-2">
        <Separator className="mb-2" />
        {atLeast('admin') ? (
          <ul className="space-y-px pb-1">
            <SidebarItem
              item={{
                key: 'settings',
                label: t('settings'),
                icon: 'Settings',
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
