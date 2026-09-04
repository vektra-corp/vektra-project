'use client'

import {
  DATE_FORMATS,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  TIME_FORMATS,
} from '@pm/shared/constants'
import { Input } from '@pm/ui'
import { Field, SelectField, SettingsForm } from '@/components/settings/settings-form'
import { updateProfile } from '../actions'

const TIMEZONES = [
  '',
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

export interface ProfileValues {
  full_name: string
  email: string
  phone: string | null
  timezone: string | null
  locale: string
  date_format: string
  time_format: string
  orgDefaults: { locale: string; date_format: string; time_format: string; timezone: string }
}

export function ProfileForm({ orgSlug, values }: { orgSlug: string; values: ProfileValues }) {
  const action = updateProfile.bind(null, orgSlug)

  return (
    <div className="space-y-5">
      <SettingsForm action={action} title="Profile" description="How you appear to your teammates.">
        <Field id="full_name" label="Full name">
          <Input
            id="full_name"
            name="full_name"
            defaultValue={values.full_name}
            required
            maxLength={120}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="email" label="Email" hint="Changing your sign-in email is not supported yet.">
            <Input id="email" value={values.email} readOnly disabled />
          </Field>
          <Field id="phone" label="Phone">
            <Input id="phone" name="phone" defaultValue={values.phone ?? ''} maxLength={30} />
          </Field>
        </div>
      </SettingsForm>

      <SettingsForm
        action={action}
        title="Your formats"
        description="These override the organization defaults for you only. Leave a field on “Organization default” to follow it."
      >
        {/* Re-posted so saving this pane does not blank the name above — both
            panes write the same profiles row through one action. */}
        <input type="hidden" name="full_name" value={values.full_name} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="p-locale" label="Language">
            <SelectField
              id="p-locale"
              name="locale"
              defaultValue={values.locale}
              options={SUPPORTED_LOCALES.map((locale) => ({
                value: locale,
                label:
                  locale === values.orgDefaults.locale
                    ? `${LOCALE_LABELS[locale]} (organization default)`
                    : LOCALE_LABELS[locale],
              }))}
            />
          </Field>
          <Field
            id="p-timezone"
            label="Timezone"
            hint={`Organization default: ${values.orgDefaults.timezone}`}
          >
            <SelectField
              id="p-timezone"
              name="timezone"
              defaultValue={values.timezone ?? ''}
              options={TIMEZONES.map((zone) => ({
                value: zone,
                label: zone === '' ? 'Organization default' : zone,
              }))}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="p-date" label="Date format">
            <SelectField
              id="p-date"
              name="date_format"
              defaultValue={values.date_format}
              options={DATE_FORMATS.map((format) => ({
                value: format,
                label:
                  format === values.orgDefaults.date_format
                    ? `${format} (organization default)`
                    : format,
              }))}
            />
          </Field>
          <Field id="p-time" label="Time format">
            <SelectField
              id="p-time"
              name="time_format"
              defaultValue={values.time_format}
              options={TIME_FORMATS.map((format) => ({
                value: format,
                label:
                  format === values.orgDefaults.time_format
                    ? `${format} (organization default)`
                    : format,
              }))}
            />
          </Field>
        </div>
      </SettingsForm>
    </div>
  )
}
