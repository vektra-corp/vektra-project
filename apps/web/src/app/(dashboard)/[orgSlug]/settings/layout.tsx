import { ORG_ADMIN_ROLES, ORG_MANAGER_ROLES } from '@pm/auth/constants'
import type { ReactNode } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { SettingsNav, type SettingsTab } from './settings-nav'

/**
 * Settings shell.
 *
 * Tabs are filtered by role so the section does not advertise pages the viewer
 * will only be bounced out of — but each page still re-checks, because a hidden
 * tab is not access control (§8).
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { orgSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const isAdmin = (ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)
  const isManager = (ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)

  const tabs: SettingsTab[] = [
    { segment: 'profile', label: 'Profile' },
    { segment: 'security', label: 'Security' },
    ...(isAdmin
      ? [
          { segment: 'general', label: 'General' },
          { segment: 'workspaces', label: 'Workspaces' },
          { segment: 'roles', label: 'Roles' },
          { segment: 'custom-fields', label: 'Custom fields' },
          { segment: 'integrations', label: 'Integrations' },
          { segment: 'audit-log', label: 'Audit log' },
        ]
      : []),
    // Sharing work outside the organization is a manager decision, so this tab
    // sits one rung lower than the rest of settings.
    ...(isManager
      ? [
          { segment: 'automation', label: 'Automation' },
          { segment: 'data', label: 'Import & export' },
        ]
      : []),
    ...(isAdmin ? [{ segment: 'billing', label: 'Billing' }] : []),
  ]

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Settings' }]} />
      {/* Rail beside the panel, both filling what the topbar leaves. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SettingsNav orgSlug={params.orgSlug} tabs={tabs} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </>
  )
}
