import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AuthCard } from '../auth-card'
import { AcceptInviteForm } from './accept-invite-form'

export const metadata: Metadata = { title: 'Accept your invitation' }

/**
 * The last step of an invitation.
 *
 * The link in the invite email goes through `/auth/callback`, which turns it
 * into a session and forwards here. Landing here without one means the link
 * expired or was already used, so this sends them to sign in rather than
 * showing a password form that could not save anything.
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: { org?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?error=invite_expired')

  // A slug is a path segment, so anything else is not one — and this value ends
  // up in a redirect. Rejecting rather than sanitizing keeps that unambiguous.
  const orgSlug =
    searchParams.org && /^[a-z0-9-]{1,60}$/.test(searchParams.org) ? searchParams.org : ''

  const [{ data: profile }, { data: membership }, { data: projectRows }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    orgSlug
      ? supabase
          .from('org_members')
          .select('organization:organizations!inner(name, slug)')
          .eq('user_id', user.id)
          .eq('organizations.slug', orgSlug)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Named on this screen so the invitation reads as an invitation to
    // something, and so the redirect that follows is not a surprise.
    supabase
      .from('project_members')
      .select('project:projects!project_members_project_id_fkey(name)')
      .eq('user_id', user.id)
      .limit(5),
  ])

  const organization = Array.isArray(membership?.organization)
    ? membership.organization[0]
    : membership?.organization

  const projectNames = (projectRows ?? [])
    .map((row) => (Array.isArray(row.project) ? row.project[0] : row.project))
    .map((project) => project?.name)
    .filter((name): name is string => Boolean(name))

  const description =
    projectNames.length > 0
      ? `Choose a password, then you will land in ${projectNames.slice(0, 2).join(' and ')}${
          projectNames.length > 2 ? ` and ${projectNames.length - 2} more` : ''
        }.`
      : 'Choose a password so you can sign in again after today.'

  return (
    <AuthCard
      title={organization ? `Join ${organization.name}` : 'Accept your invitation'}
      description={description}
    >
      <AcceptInviteForm
        orgSlug={orgSlug}
        email={user.email ?? ''}
        defaultName={profile?.full_name ?? ''}
      />
    </AuthCard>
  )
}
