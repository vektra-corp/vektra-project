import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import type { ReactNode } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { CommercialNav } from './commercial-nav'

/**
 * Commercial shell.
 *
 * Gated at manager and above, matching the RLS policy on commercial_documents —
 * a member reaching this URL would otherwise see a working page with nothing in
 * it, which reads as a bug rather than as a permission boundary.
 */
export default async function CommercialLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { orgSlug: string; workspaceSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const base = `/${params.orgSlug}/${params.workspaceSlug}/commercial`

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Commercial' }]} />
      {/* The design rules the section's tab row off from the table under it,
          the same strip the project views use. */}
      <div className="border-border flex shrink-0 flex-wrap items-center gap-4 border-b px-5 py-2.5">
        <CommercialNav base={base} />
      </div>
      {children}
    </>
  )
}
