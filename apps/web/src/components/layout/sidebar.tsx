import type { OrgRole } from '@pm/shared/constants'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { SidebarPaletteTrigger } from './palette-trigger'
import { SidebarItem, SidebarProjectGroup, SidebarSection, type NavItem } from './sidebar-nav'
import { SidebarUser } from './sidebar-user'
import { WorkspaceSwitcher, type SwitcherWorkspace } from './workspace-switcher'

/** Project views with a route today; the rest render as "soon". */
const ROUTED_PROJECT_VIEWS = [
  'overview',
  'list',
  'board',
  'timeline',
  'workload',
  'documents',
  'settings',
]

/** The design lists five projects, then "Show all". */
const SIDEBAR_PROJECT_LIMIT = 5

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
 * The structure is the design's: an identity row that switches workspace, the
 * jump-to field, three top-level destinations, then WORK · GENERAL, COMMERCIAL,
 * PEOPLE and INSIGHTS as mono-captioned groups, with settings and the signed-in
 * user pinned to the bottom.
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

  const primaryWorkspace = workspaces[0] ?? null

  const switcherWorkspaces: SwitcherWorkspace[] = workspaces.map((workspace, index) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    sub: `${workspace.name.toUpperCase()} · WORKSPACE`,
    meta: `${orgName} · ${orgRole}`,
    color: workspace.color,
    current: index === 0,
  }))

  // Commercial lives inside a workspace, so its links need one. A member with
  // no workspace sees the rows inert rather than pointing at a 404.
  const commercialHref = (segment: string) =>
    primaryWorkspace && atLeast('manager')
      ? `/${orgSlug}/${primaryWorkspace.slug}/commercial/${segment}`
      : undefined

  const commercial: NavItem[] = [
    { key: 'quotations', label: t('quotations'), icon: 'quotation', href: commercialHref('quotations') },
    { key: 'contacts', label: t('contacts'), icon: 'salesOrder', href: commercialHref('contacts') },
    { key: 'templates', label: t('pdfTemplates'), icon: 'purchaseOrder', href: commercialHref('templates') },
  ]

  // The design's project views, in its sidebar order: Documents and Settings
  // belong to the project rather than to its task views, so they sit here.
  const projectViews: NavItem[] = [
    { key: 'overview', label: t('overview'), icon: 'projects' },
    { key: 'list', label: t('list'), icon: 'list' },
    { key: 'board', label: t('board'), icon: 'board' },
    { key: 'timeline', label: t('timeline'), icon: 'timeline' },
    { key: 'workload', label: t('workload'), icon: 'workload' },
    { key: 'documents', label: t('documents'), icon: 'documents' },
    { key: 'settings', label: t('settings'), icon: 'settings' },
  ]

  const visibleProjects = projects.slice(0, SIDEBAR_PROJECT_LIMIT)
  const hiddenProjectCount = projects.length - visibleProjects.length

  return (
    <aside className="border-border bg-surface scrollbar-slim hidden w-[242px] shrink-0 flex-col gap-[15px] overflow-y-auto border-e px-3 py-3.5 md:flex">
      <WorkspaceSwitcher
        orgSlug={orgSlug}
        workspaces={switcherWorkspaces}
        current={{
          name: primaryWorkspace?.name ?? orgName,
          sub: primaryWorkspace ? `${orgName.toUpperCase()} · WORKSPACE` : 'ORGANIZATION',
        }}
      />

      <SidebarPaletteTrigger label={t('jumpTo')} />

      <nav className="flex flex-col gap-[15px]" aria-label="Primary">
        <ul className="flex flex-col gap-0.5">
          <SidebarItem
            item={{
              key: 'dashboard',
              label: t('dashboard'),
              icon: 'dashboard',
              href: `/${orgSlug}/dashboard`,
            }}
          />
          <SidebarItem
            item={{
              key: 'inbox',
              label: t('inbox'),
              icon: 'inbox',
              href: `/${orgSlug}/notifications`,
              count: inboxCount,
              countTone: 'accent',
            }}
          />
          <SidebarItem
            item={{
              key: 'my-tasks',
              label: t('myTasks'),
              icon: 'myTasks',
              href: `/${orgSlug}/my-tasks`,
              count: myTaskCount,
            }}
          />
        </ul>

        <SidebarSection
          title={`${t('work')} · ${(primaryWorkspace?.name ?? t('general')).toUpperCase()}`}
          collapsible
        >
          <SidebarItem
            item={{
              key: 'projects',
              label: t('projects'),
              icon: 'projects',
              href: primaryWorkspace ? `/${orgSlug}/${primaryWorkspace.slug}/projects` : undefined,
              count: projects.length,
              exact: true,
            }}
          />

          {visibleProjects.map((project) => (
            <SidebarProjectGroup
              key={project.id}
              orgSlug={orgSlug}
              project={{
                id: project.id,
                name: project.name,
                workspaceSlug: project.workspace_slug,
                color: project.color,
              }}
              views={projectViews.map((view) =>
                ROUTED_PROJECT_VIEWS.includes(view.key)
                  ? {
                      ...view,
                      href: `/${orgSlug}/${project.workspace_slug}/projects/${project.id}/${view.key}`,
                    }
                  : view,
              )}
            />
          ))}

          {hiddenProjectCount > 0 && primaryWorkspace ? (
            <li>
              <Link
                href={`/${orgSlug}/${primaryWorkspace.slug}/projects`}
                className="text-primary hover:bg-surface-hover block rounded-md py-[5px] pe-2.5 ps-[11px] text-micro transition-colors"
              >
                Show all {projects.length} projects
              </Link>
            </li>
          ) : null}

          {workspaces.length === 0 ? (
            <li className="text-faint px-2.5 py-2 text-base">{t('noWorkspaces')}</li>
          ) : null}

          <SidebarItem
            item={{
              key: 'workflows',
              label: t('workflows'),
              icon: 'workflows',
              href:
                primaryWorkspace && atLeast('manager')
                  ? `/${orgSlug}/${primaryWorkspace.slug}/workflows`
                  : undefined,
            }}
          />
        </SidebarSection>

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
              icon: 'team',
              href: `/${orgSlug}/team`,
              exact: true,
            }}
          />
          {atLeast('manager') ? (
            <SidebarItem
              item={{ key: 'members', label: t('members'), icon: 'members', href: `/${orgSlug}/members` }}
            />
          ) : null}
          <SidebarItem
            item={{ key: 'leave', label: t('leave'), icon: 'leave', href: `/${orgSlug}/team/leave` }}
          />
          <SidebarItem
            item={{
              key: 'timesheets',
              label: t('timesheets'),
              icon: 'timesheet',
              href: `/${orgSlug}/timesheets`,
            }}
          />
        </SidebarSection>

        {atLeast('manager') ? (
          <SidebarSection title={t('insights')}>
            <SidebarItem
              item={{ key: 'reports', label: t('reports'), icon: 'reports', href: `/${orgSlug}/reports` }}
            />
            <SidebarItem
              item={{ key: 'revenue', label: t('revenue'), icon: 'revenue', href: `/${orgSlug}/revenue` }}
            />
          </SidebarSection>
        ) : null}
      </nav>

      <div className="border-border mt-auto flex flex-col gap-0.5 border-t pt-2">
        <ul className="flex flex-col gap-0.5">
          <SidebarItem
            item={{
              key: 'settings',
              label: t('settings'),
              icon: 'settings',
              href: `/${orgSlug}/settings`,
            }}
          />
        </ul>
        <SidebarUser orgSlug={orgSlug} orgRole={orgRole} profile={profile} />
      </div>
    </aside>
  )
}
