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
    ...(isAdmin
      ? [
          { segment: 'general', label: 'General' },
          { segment: 'workspaces', label: 'Workspaces' },
          { segment: 'roles', label: 'Roles' },
        ]
      : []),
    // Sharing work outside the organization is a manager decision, so this tab
    // sits one rung lower than the rest of settings.
    ...(isManager ? [{ segment: 'portal', label: 'Portal access' }] : []),
    ...(isAdmin ? [{ segment: 'billing', label: 'Billing' }] : []),
  ]

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Settings' }]} />
      <SettingsNav orgSlug={params.orgSlug} tabs={tabs} />
      {children}
    </>
  )
}
