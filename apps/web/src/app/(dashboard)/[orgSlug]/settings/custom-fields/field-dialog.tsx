'use client'

import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
} from '@pm/shared/constants'
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
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
import { AlertCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Field, SelectField } from '@/components/settings/settings-form'
import { deleteCustomField, saveCustomField } from './actions'

export interface FieldRecord {
  id: string
  entityType: string
  name: string
  fieldType: string
  options: string[]
  isRequired: boolean
  position: number
  valueCount: number
}

function SubmitButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {isNew ? 'Add field' : 'Save changes'}
    </Button>
  )
}

export function FieldDialog({ orgSlug, field }: { orgSlug: string; field?: FieldRecord }) {
  const [open, setOpen] = useState(false)
  const isNew = !field
  const [fieldType, setFieldType] = useState(field?.fieldType ?? 'text')
  const [state, formAction] = useFormState(
    saveCustomField.bind(null, orgSlug, field?.id ?? null),
    null,
  )
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      toast({ title: isNew ? 'Field added' : 'Field updated' })
      router.refresh()
    }
  }, [state, router, isNew])

  const fieldError = (name: string) =>
    state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined

  return (
    <>
      {isNew ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New field
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${field.name}`}
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isNew ? 'New custom field' : field.name}</DialogTitle>
            <DialogDescription>
              Appears on every record of the chosen type across this organization.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            {state && !state.ok && !state.fieldErrors ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            <Field id="cf-name" label="Name" error={fieldError('name')}>
              <Input
                id="cf-name"
                name="name"
                required
                autoFocus
                maxLength={80}
                defaultValue={field?.name ?? ''}
                placeholder="Client reference"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="cf-entity"
                label="Applies to"
                hint={isNew ? undefined : 'Cannot be changed after creation.'}
              >
                <SelectField
                  id="cf-entity"
                  name="entity_type"
                  defaultValue={field?.entityType ?? 'task'}
                  options={CUSTOM_FIELD_ENTITIES.map((entity) => ({
                    value: entity,
                    label: CUSTOM_FIELD_ENTITY_LABELS[entity],
                  }))}
                />
              </Field>

              <Field
                id="cf-type"
                label="Type"
                hint={
                  isNew
                    ? undefined
                    : 'Cannot be changed — existing values are stored in this type’s shape.'
                }
              >
                <SelectField
                  id="cf-type"
                  name="field_type"
                  defaultValue={field?.fieldType ?? 'text'}
                  options={CUSTOM_FIELD_TYPES.map((type) => ({
                    value: type,
                    label: CUSTOM_FIELD_TYPE_LABELS[type],
                  }))}
                />
              </Field>
            </div>

            {/* The type select is uncontrolled so the form still works without
                hydration; this mirrors it only to decide what else to show. */}
            <div onChange={(event) => {
              const target = event.target as HTMLSelectElement
              if (target.name === 'field_type') setFieldType(target.value)
            }}>
              {fieldType === 'dropdown' || field?.fieldType === 'dropdown' ? (
                <Field
                  id="cf-options"
                  label="Options"
                  hint="One per line."
                  error={fieldError('options')}
                >
                  <Textarea
                    id="cf-options"
                    name="options"
                    rows={4}
                    defaultValue={field?.options.join('\n') ?? ''}
                    placeholder={'Low\nMedium\nHigh'}
                  />
                </Field>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="cf-position" label="Order" hint="Lower numbers appear first.">
                <Input
                  id="cf-position"
                  name="position"
                  type="number"
                  min="0"
                  defaultValue={field?.position ?? 0}
                />
              </Field>

              <label className="flex cursor-pointer items-end gap-2.5 pb-2 text-[13px]">
                <Checkbox name="is_required" size="sm" defaultChecked={field?.isRequired} />
                Required
              </label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton isNew={isNew} />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function DeleteFieldButton({
  orgSlug,
  field,
}: {
  orgSlug: string
  field: FieldRecord
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${field.name}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{field.name}”?</DialogTitle>
            <DialogDescription>
              {field.valueCount > 0
                ? `This discards ${field.valueCount} value${field.valueCount === 1 ? '' : 's'} already entered against it. That cannot be undone.`
                : 'No values have been entered for this field yet.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteCustomField(orgSlug, field.id)
                  if (result.ok) {
                    setOpen(false)
                    toast({ title: 'Field deleted' })
                    router.refresh()
                  } else {
                    toast({
                      variant: 'destructive',
                      title: 'Could not delete',
                      description: result.message,
                    })
                  }
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
