'use client'

import type { CommercialDocType } from '@pm/shared/constants'
import { Alert, AlertDescription, Button, Input, Textarea } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Field, SelectField } from '@/components/settings/settings-form'
import { saveCommercialDoc } from './actions'
import { LineItemEditor, type EditableLineItem } from './line-item-editor'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  )
}

export interface DocumentFormValues {
  id?: string
  contactId: string | null
  projectId: string | null
  issueDate: string
  dueDate: string | null
  validUntil: string | null
  currency: string
  notes: string | null
  terms: string | null
  lineItems: EditableLineItem[]
}

/**
 * Create or edit a commercial document.
 *
 * Header and lines post together as one form: a document whose lines saved but
 * whose header did not would be a half-written record with a live number.
 */
export function DocumentForm({
  scope,
  docType,
  docSegment,
  workspaceId,
  contacts,
  projects,
  locale,
  values,
}: {
  scope: { orgSlug: string; workspaceSlug: string }
  docType: CommercialDocType
  docSegment: string
  workspaceId: string
  contacts: { id: string; label: string }[]
  projects: { id: string; name: string }[]
  locale: string
  values: DocumentFormValues
}) {
  const isNew = !values.id
  const router = useRouter()

  const [state, formAction] = useFormState(
    saveCommercialDoc.bind(null, scope, values.id ?? null),
    null,
  )

  const base = `/${scope.orgSlug}/${scope.workspaceSlug}/commercial/${docSegment}`

  // Navigating from an effect rather than redirecting inside the action keeps
  // the validation errors renderable when the submit fails.
  useEffect(() => {
    if (state?.ok) {
      router.push(`${base}/${state.data.id}`)
      router.refresh()
    }
  }, [state, router, base])

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <form action={formAction} className="space-y-5">
      {state && !state.ok && !state.fieldErrors ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <input type="hidden" name="doc_type" value={docType} />
      <input type="hidden" name="workspace_id" value={workspaceId} />

      <div className="grid gap-4 rounded-lg border border-border bg-surface p-5 shadow-card sm:grid-cols-2 lg:grid-cols-3">
        <Field id="contact_id" label={docType === 'bill' || docType === 'purchase_order' ? 'Vendor' : 'Client'}>
          <SelectField
            id="contact_id"
            name="contact_id"
            defaultValue={values.contactId ?? ''}
            options={[
              { value: '', label: 'No contact' },
              ...contacts.map((contact) => ({ value: contact.id, label: contact.label })),
            ]}
          />
        </Field>

        <Field id="project_id" label="Project" hint="Optional — links this to delivery work.">
          <SelectField
            id="project_id"
            name="project_id"
            defaultValue={values.projectId ?? ''}
            options={[
              { value: '', label: 'No project' },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
        </Field>

        <Field id="currency" label="Currency">
          <Input
            id="currency"
            name="currency"
            defaultValue={values.currency}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            className="uppercase"
          />
        </Field>

        <Field id="issue_date" label="Issue date" error={fieldError('issue_date')}>
          <Input
            id="issue_date"
            name="issue_date"
            type="date"
            required
            defaultValue={values.issueDate}
          />
        </Field>

        {docType === 'quotation' ? (
          <Field id="valid_until" label="Valid until" hint="After this date the offer expires.">
            <Input
              id="valid_until"
              name="valid_until"
              type="date"
              defaultValue={values.validUntil ?? ''}
            />
          </Field>
        ) : (
          <Field id="due_date" label="Due date" error={fieldError('due_date')}>
            <Input id="due_date" name="due_date" type="date" defaultValue={values.dueDate ?? ''} />
          </Field>
        )}
      </div>

      <LineItemEditor
        name="line_items"
        currency={values.currency}
        locale={locale}
        initialItems={values.lineItems}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="notes" label="Notes" hint="Shown on the document.">
          <Textarea id="notes" name="notes" rows={3} defaultValue={values.notes ?? ''} />
        </Field>
        <Field id="terms" label="Terms">
          <Textarea id="terms" name="terms" rows={3} defaultValue={values.terms ?? ''} />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <SubmitButton label={isNew ? 'Create draft' : 'Save changes'} />
      </div>
    </form>
  )
}
