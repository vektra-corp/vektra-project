import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { DEFAULT_FORMAT_OPTIONS } from '@pm/shared/constants'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { GeneralForm } from './general-form'

export const metadata: Metadata = { title: 'General settings' }

export default async function GeneralSettingsPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const { data: organization } = await supabase
    .from('organizations')
    .select('name, billing_email, tax_id, currency, timezone, settings')
    .eq('id', auth.orgId)
    .maybeSingle()

  if (!organization) notFound()

  const settings = (organization.settings as Record<string, string> | null) ?? {}
  const readOnly = !(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)

  return (
    <PageBody>
      <div className="max-w-2xl">
        <GeneralForm
          orgSlug={params.orgSlug}
          readOnly={readOnly}
          values={{
            name: organization.name,
            billing_email: organization.billing_email,
            tax_id: organization.tax_id,
            currency: organization.currency,
            timezone: organization.timezone,
            locale: settings.locale ?? DEFAULT_FORMAT_OPTIONS.locale,
            date_format: settings.date_format ?? DEFAULT_FORMAT_OPTIONS.dateFormat,
            time_format: settings.time_format ?? DEFAULT_FORMAT_OPTIONS.timeFormat,
          }}
        />
      </div>
    </PageBody>
  )
}
