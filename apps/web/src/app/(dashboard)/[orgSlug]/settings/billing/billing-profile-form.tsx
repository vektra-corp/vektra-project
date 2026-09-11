'use client'

import { BILLING_COUNTRIES, GST_STATE_CODES } from '@pm/shared/constants'
import { Input } from '@pm/ui'
import { useState } from 'react'
import { Field, SelectField, SettingsForm } from '@/components/settings/settings-form'
import { updateBillingProfile } from './actions'

/**
 * Where this organization is billed from.
 *
 * Not a preference. The country selected here decides three things at once:
 * which gateway holds the mandate, which currency the customer is quoted in,
 * and whether their invoice carries GST or is a zero-rated export. That is why
 * the field is owner-only and why it freezes once a subscription is live.
 *
 * The state and GSTIN inputs appear only for India, because they mean nothing
 * anywhere else — and the validator rejects them outright for other countries
 * rather than quietly discarding them.
 */
export function BillingProfileForm({
  orgSlug,
  billingCountry,
  billingState,
  gstin,
  canEdit,
  frozen,
}: {
  orgSlug: string
  billingCountry: string | null
  billingState: string | null
  gstin: string | null
  canEdit: boolean
  frozen: boolean
}) {
  const [country, setCountry] = useState(billingCountry ?? '')
  const isIndia = country === 'IN'

  const action = updateBillingProfile.bind(null, orgSlug)

  return (
    <SettingsForm
      action={action}
      title="Billing details"
      description={
        frozen
          ? 'Your billing country is fixed while a subscription is active.'
          : 'Decides your currency, your payment method and how your invoices are taxed.'
      }
      submitLabel="Save billing details"
    >
      <Field
        id="billing_country"
        label="Billing country"
        hint={
          billingCountry
            ? undefined
            : 'Set this before subscribing — until it is set you will be quoted in US dollars.'
        }
      >
        <select
          id="billing_country"
          name="billing_country"
          value={country}
          disabled={!canEdit || frozen}
          onChange={(event) => setCountry(event.target.value)}
          className="border-border bg-surface h-9 w-full rounded-md border px-3 text-ui disabled:opacity-60"
        >
          <option value="">Select a country…</option>
          {BILLING_COUNTRIES.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
      </Field>

      {isIndia ? (
        <>
          <Field
            id="billing_state"
            label="State"
            hint="Decides whether your invoice carries CGST + SGST or IGST."
          >
            <SelectField
              id="billing_state"
              name="billing_state"
              defaultValue={billingState ?? ''}
              options={[
                { value: '', label: 'Select a state…' },
                ...GST_STATE_CODES.map((state) => ({
                  value: state.code,
                  label: `${state.name} (${state.code})`,
                })),
              ]}
            />
          </Field>

          <Field
            id="gstin"
            label="GSTIN (optional)"
            hint="If you are registered. Must belong to the state selected above."
          >
            <Input
              id="gstin"
              name="gstin"
              defaultValue={gstin ?? ''}
              placeholder="29ABCDE1234F1Z5"
              maxLength={15}
              autoComplete="off"
              disabled={!canEdit}
            />
          </Field>
        </>
      ) : (
        // Cleared rather than omitted: leaving stale Indian values in the form
        // would resubmit them for a country where the validator refuses them.
        <>
          <input type="hidden" name="billing_state" value="" />
          <input type="hidden" name="gstin" value="" />
        </>
      )}

      {!canEdit ? (
        <p className="text-muted-foreground text-xs">
          Only the organization owner can change billing details.
        </p>
      ) : null}
    </SettingsForm>
  )
}
