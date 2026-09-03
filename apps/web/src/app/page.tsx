import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Entry point for a signed-in user: send them to their default organization,
 * or to onboarding if they do not belong to one yet.
 *
 * Unauthenticated requests never reach here — middleware redirects first.
 */
export default async function RootPage() {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_members')
    .select('organizations!inner(slug)')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle()

  const org = membership?.organizations as unknown as { slug: string } | null
  if (org?.slug) redirect(`/${org.slug}/dashboard`)

  // An invited external user has a portal record but no org membership.
  const { data: portal } = await supabase
    .from('portal_users')
    .select('organizations!inner(slug)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  const portalOrg = portal?.organizations as unknown as { slug: string } | null
  if (portalOrg?.slug) redirect(`/portal/${portalOrg.slug}`)

  redirect('/onboarding')
}
