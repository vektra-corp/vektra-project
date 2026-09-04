'use client'

import {
  DATE_FORMATS,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  TIME_FORMATS,
} from '@pm/shared/constants'
import { Input } from '@pm/ui'
import { Field, SelectField, SettingsForm } from '@/components/settings/settings-form'
import { updateOrganization } from '../actions'

/** Common IANA zones. The field accepts any zone the runtime validates. */
const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'JPY', 'SGD', 'AED', 'BRL']

export interface OrganizationSettingsValues {
  name: string
  billing_email: string | null
  tax_id: string | null
  currency: string
  timezone: string
  locale: string
  date_format: string
  time_format: string
}

export function GeneralForm({
  orgSlug,
  values,
  readOnly,
}: {
  orgSlug: string
  values: OrganizationSettingsValues
  readOnly: boolean
}) {
  const action = updateOrganization.bind(null, orgSlug)

  return (
    <div className="space-y-5">
      <SettingsForm
        action={action}
        title="Organization"
        description="How this tenant is identified across the product and on documents."
        footer={readOnly ? 'You need admin access to change these.' : undefined}
      >
        <fieldset disabled={readOnly} className="space-y-4">
          <Field id="name" label="Name">
            <Input id="name" name="name" defaultValue={values.name} required maxLength={120} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="billing_email" label="Billing email" hint="Where invoices and dunning go.">
              <Input
                id="billing_email"
                name="billing_email"
                type="email"
                defaultValue={values.billing_email ?? ''}
              />
            </Field>
            <Field id="tax_id" label="Tax ID">
              <Input id="tax_id" name="tax_id" defaultValue={values.tax_id ?? ''} maxLength={60} />
            </Field>
          </div>

          <Field id="slug" label="URL slug" hint="Changing the slug is not supported yet.">
            <Input id="slug" value={orgSlug} readOnly disabled />
          </Field>
        </fieldset>
      </SettingsForm>

      <SettingsForm
        action={action}
        title="Localization"
        description="Defaults for everyone in this organization. Each person can override them on their own profile."
        footer={readOnly ? 'You need admin access to change these.' : undefined}
      >
        <fieldset disabled={readOnly} className="space-y-4">
          {/* Re-posted so saving this pane does not blank the fields above,
              which share one server action and one row. */}
          <input type="hidden" name="name" value={values.name} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="locale" label="Language">
              <SelectField
                id="locale"
                name="locale"
                defaultValue={values.locale}
                options={SUPPORTED_LOCALES.map((locale) => ({
                  value: locale,
                  label: LOCALE_LABELS[locale],
                }))}
              />
            </Field>
            <Field id="timezone" label="Timezone" hint="Used for due dates and scheduled reports.">
              <SelectField
                id="timezone"
                name="timezone"
                defaultValue={values.timezone}
                options={TIMEZONES.map((zone) => ({ value: zone, label: zone }))}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="date_format" label="Date format">
              <SelectField
                id="date_format"
                name="date_format"
                defaultValue={values.date_format}
                options={DATE_FORMATS.map((format) => ({ value: format, label: format }))}
              />
            </Field>
            <Field id="time_format" label="Time format">
              <SelectField
                id="time_format"
                name="time_format"
                defaultValue={values.time_format}
                options={TIME_FORMATS.map((format) => ({ value: format, label: format }))}
              />
            </Field>
            <Field id="currency" label="Currency">
              <SelectField
                id="currency"
                name="currency"
                defaultValue={values.currency}
                options={CURRENCIES.map((code) => ({ value: code, label: code }))}
              />
            </Field>
          </div>
        </fieldset>
      </SettingsForm>
    </div>
  )
}
