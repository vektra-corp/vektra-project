import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    orgSlug
      ? supabase
          .from('org_members')
          .select('organization:organizations!inner(name, slug)')
          .eq('user_id', user.id)
          .eq('organizations.slug', orgSlug)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const organization = Array.isArray(membership?.organization)
    ? membership.organization[0]
    : membership?.organization

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-head">
          {organization ? `Join ${organization.name}` : 'Accept your invitation'}
        </CardTitle>
        <CardDescription>
          Choose a password so you can sign in again after today.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInviteForm
          orgSlug={orgSlug}
          email={user.email ?? ''}
          defaultName={profile?.full_name ?? ''}
        />
      </CardContent>
    </Card>
  )
}
