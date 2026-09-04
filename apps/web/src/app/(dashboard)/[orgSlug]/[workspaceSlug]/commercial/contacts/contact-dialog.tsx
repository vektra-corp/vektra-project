'use client'

import { CONTACT_TYPES, type CustomFieldDefinition } from '@pm/shared/constants'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  toast,
} from '@pm/ui'
import { AlertCircle, Pencil, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { CustomFieldInputs, type CustomValue } from '@/components/custom-fields/custom-field-inputs'
import { Field, SelectField } from '@/components/settings/settings-form'
import { saveContact } from './actions'

export interface ContactRecord {
  id: string
  type: string
  companyName: string | null
  contactName: string
  email: string | null
  phone: string | null
  taxId: string | null
  notes: string | null
  address: { street?: string; city?: string; country?: string } | null
}

function SubmitButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {isNew ? 'Add contact' : 'Save changes'}
    </Button>
  )
}

export function ContactDialog({
  scope,
  contact,
  customFields = [],
  customValues = {},
}: {
  scope: { orgSlug: string; workspaceSlug: string }
  contact?: ContactRecord
  customFields?: CustomFieldDefinition[]
  customValues?: Record<string, CustomValue>
}) {
  const [open, setOpen] = useState(false)
  const isNew = !contact
  const [state, formAction] = useFormState(saveContact.bind(null, scope, contact?.id ?? null), null)
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      toast({ title: isNew ? 'Contact added' : 'Contact updated' })
      router.refresh()
    }
  }, [state, router, isNew])

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <>
      {isNew ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          New contact
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${contact.contactName}`}
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isNew ? 'New contact' : contact.contactName}</DialogTitle>
            <DialogDescription>
              Clients appear on quotations, sales orders and invoices; vendors on purchase orders
              and bills.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            {state && !state.ok && !state.fieldErrors ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="contact_name" label="Contact name" error={fieldError('contact_name')}>
                <Input
                  id="contact_name"
                  name="contact_name"
                  required
                  autoFocus
                  maxLength={150}
                  defaultValue={contact?.contactName ?? ''}
                />
              </Field>
              <Field id="type" label="Type">
                <SelectField
                  id="type"
                  name="type"
                  defaultValue={contact?.type ?? 'client'}
                  options={CONTACT_TYPES.map((type) => ({ value: type, label: type }))}
                />
              </Field>
            </div>

            <Field id="company_name" label="Company">
              <Input
                id="company_name"
                name="company_name"
                maxLength={150}
                defaultValue={contact?.companyName ?? ''}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="email" label="Email" error={fieldError('email')}>
                <Input id="email" name="email" type="email" defaultValue={contact?.email ?? ''} />
              </Field>
              <Field id="phone" label="Phone">
                <Input id="phone" name="phone" maxLength={40} defaultValue={contact?.phone ?? ''} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="street" label="Street">
                <Input id="street" name="street" defaultValue={contact?.address?.street ?? ''} />
              </Field>
              <Field id="city" label="City">
                <Input id="city" name="city" defaultValue={contact?.address?.city ?? ''} />
              </Field>
              <Field id="country" label="Country">
                <Input id="country" name="country" defaultValue={contact?.address?.country ?? ''} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="tax_id" label="Tax ID">
                <Input id="tax_id" name="tax_id" maxLength={60} defaultValue={contact?.taxId ?? ''} />
              </Field>
            </div>

            <Field id="notes" label="Notes">
              <Textarea id="notes" name="notes" rows={2} defaultValue={contact?.notes ?? ''} />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton isNew={isNew} />
            </DialogFooter>
          </form>

          {/*
            Custom fields save themselves, so they sit outside the contact form
            rather than inside it — a nested submit button would post the outer
            form. They need an id to attach values to, which a contact that has
            not been created yet does not have.
          */}
          {!isNew && customFields.length > 0 && contact ? (
            <div className="border-t border-border-subtle pt-4">
              <p className="label-meta pb-3 text-faint">Custom fields</p>
              <CustomFieldInputs
                orgSlug={scope.orgSlug}
                entityType="contact"
                entityId={contact.id}
                fields={customFields}
                values={customValues}
                canEdit
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
