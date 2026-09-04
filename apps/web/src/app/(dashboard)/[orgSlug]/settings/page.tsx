import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { redirect } from 'next/navigation'
import { requireAuthPage } from '@/lib/auth/context'

/** Settings has no landing page of its own — send each role to its first tab. */
export default async function SettingsIndexPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  const isAdmin = (ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)
  redirect(`/${params.orgSlug}/settings/${isAdmin ? 'general' : 'profile'}`)
}
