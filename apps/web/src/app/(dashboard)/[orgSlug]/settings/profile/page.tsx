import { DEFAULT_FORMAT_OPTIONS } from '@pm/shared/constants'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SettingsPanel } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { ProfileForm } from './profile-form'

export const metadata: Metadata = { title: 'Profile' }

export default async function ProfileSettingsPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const [{ data: profile }, { data: organization }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, phone, timezone, settings')
      .eq('id', auth.userId)
      .maybeSingle(),
    supabase.from('organizations').select('timezone, settings').eq('id', auth.orgId).maybeSingle(),
  ])

  if (!profile) notFound()

  const mine = (profile.settings as Record<string, string> | null) ?? {}
  const org = (organization?.settings as Record<string, string> | null) ?? {}

  const orgDefaults = {
    locale: org.locale ?? DEFAULT_FORMAT_OPTIONS.locale,
    date_format: org.date_format ?? DEFAULT_FORMAT_OPTIONS.dateFormat,
    time_format: org.time_format ?? DEFAULT_FORMAT_OPTIONS.timeFormat,
    timezone: organization?.timezone ?? DEFAULT_FORMAT_OPTIONS.timezone,
  }

  return (
    <SettingsPanel>
        <ProfileForm
          orgSlug={params.orgSlug}
          values={{
            full_name: profile.full_name,
            email: auth.email ?? '',
            phone: profile.phone,
            timezone: profile.timezone,
            // Falling back to the org default means the select shows what is
            // actually in effect, not an empty control.
            locale: mine.locale ?? orgDefaults.locale,
            date_format: mine.date_format ?? orgDefaults.date_format,
            time_format: mine.time_format ?? orgDefaults.time_format,
            orgDefaults,
          }}
        />
    </SettingsPanel>
  )
}
