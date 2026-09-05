import { slugify } from '@pm/shared/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { OnboardingForm } from './onboarding-form'

export const metadata: Metadata = { title: 'Create your organization' }

export default async function OnboardingPage() {
  const t = await getTranslations('onboarding')
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Someone who already belongs to an org has no business here.
  const { data: existing } = await supabase
    .from('org_members')
    .select('organizations!inner(slug)')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  const org = existing?.organizations as unknown as { slug: string } | null
  if (org?.slug) redirect(`/${org.slug}/dashboard`)

  // Carried over from the signup form so the field arrives pre-filled.
  const suggestedName =
    (user.user_metadata?.pending_organization_name as string | undefined) ?? ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-head">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm
            defaultName={suggestedName}
            defaultSlug={suggestedName ? slugify(suggestedName) : ''}
          />
        </CardContent>
      </Card>
    </div>
  )
}
