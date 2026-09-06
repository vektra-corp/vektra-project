'use client'

import { COMMERCIAL_DOC_TYPES } from '@pm/shared/constants'
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
} from '@pm/ui'
import { AlertCircle, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Field, SelectField } from '@/components/settings/settings-form'
import { createTemplate } from './actions'

const label = (value: string) =>
  value.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase())

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      Create template
    </Button>
  )
}

export function NewTemplateDialog({
  scope,
}: {
  scope: { orgSlug: string; workspaceSlug: string }
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useFormState(createTemplate.bind(null, scope), null)
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      router.refresh()
    }
  }, [state, router])

  const fieldError = (name: string) =>
    state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        New template
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New PDF template</DialogTitle>
            <DialogDescription>
              Starts from the built-in layout. Adjust it, then make it the default for
              this document type.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            {state && !state.ok && !state.fieldErrors ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            <Field id="new-tpl-name" label="Name" error={fieldError('name')}>
              <Input
                id="new-tpl-name"
                name="name"
                required
                autoFocus
                maxLength={80}
                placeholder="Standard quotation"
              />
            </Field>

            <Field id="new-tpl-type" label="Document type">
              <SelectField
                id="new-tpl-type"
                name="doc_type"
                defaultValue="quotation"
                options={COMMERCIAL_DOC_TYPES.map((value) => ({ value, label: label(value) }))}
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
