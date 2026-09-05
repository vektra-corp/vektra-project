'use client'

import {
  coerceCustomValue,
  validateCustomValue,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from '@pm/shared/constants'
import { Button, Checkbox, Input, cn, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { saveCustomValues } from '@/app/(dashboard)/[orgSlug]/settings/custom-fields/actions'

export type CustomValue = string | number | boolean | null

/**
 * Custom fields on an entity (§6.7).
 *
 * Values are validated with the same functions the server uses, so what the
 * form accepts is what will store. Saving sends only the fields rendered here,
 * and the action ignores any id that does not belong to this entity type.
 */
export function CustomFieldInputs({
  orgSlug,
  entityType,
  entityId,
  fields,
  values: initialValues,
  canEdit,
}: {
  orgSlug: string
  entityType: CustomFieldEntity
  entityId: string
  fields: CustomFieldDefinition[]
  values: Record<string, CustomValue>
  canEdit: boolean
}) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  if (fields.length === 0) return null

  function set(field: CustomFieldDefinition, raw: unknown) {
    const value = coerceCustomValue(field.field_type, raw)
    setValues((current) => ({ ...current, [field.id]: value }))
    setDirty(true)

    // Clear the error as soon as the value is valid again, rather than making
    // someone press save to find out.
    const problem = validateCustomValue(field, value)
    setErrors((current) => {
      const next = { ...current }
      if (problem) next[field.id] = problem.message
      else delete next[field.id]
      return next
    })
  }

  function save() {
    const found: Record<string, string> = {}
    for (const field of fields) {
      const problem = validateCustomValue(field, values[field.id] ?? null)
      if (problem) found[field.id] = problem.message
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return

    startTransition(async () => {
      const result = await saveCustomValues(orgSlug, entityType, entityId, values)
      if (result.ok) {
        setDirty(false)
        toast({ title: 'Saved' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not save', description: result.message })
      }
    })
  }

  const inputClass =
    'flex h-9 w-full rounded-md border border-input bg-card px-3 text-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60'

  return (
    <section className="space-y-3">
      <h2 className="text-ui font-medium">Custom fields</h2>

      <dl className="space-y-3">
        {fields.map((field) => {
          const value = values[field.id] ?? null
          const error = errors[field.id]
          const id = `cf-${field.id}`

          return (
            <div key={field.id} className="space-y-1.5">
              <label htmlFor={id} className="label-meta block text-faint">
                {field.name}
                {field.is_required ? <span className="ps-1 text-destructive">*</span> : null}
              </label>

              {field.field_type === 'checkbox' ? (
                <Checkbox
                  id={id}
                  size="sm"
                  checked={value === true}
                  disabled={!canEdit || pending}
                  onChange={(event) => set(field, event.target.checked)}
                />
              ) : field.field_type === 'dropdown' ? (
                <select
                  id={id}
                  value={typeof value === 'string' ? value : ''}
                  disabled={!canEdit || pending}
                  onChange={(event) => set(field, event.target.value)}
                  className={cn(inputClass, error && 'border-destructive')}
                >
                  <option value="">—</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={id}
                  type={
                    field.field_type === 'number' || field.field_type === 'currency'
                      ? 'number'
                      : field.field_type === 'date'
                        ? 'date'
                        : field.field_type === 'email'
                          ? 'email'
                          : field.field_type === 'url'
                            ? 'url'
                            : 'text'
                  }
                  step={field.field_type === 'currency' ? '0.01' : undefined}
                  value={value === null || value === false ? '' : String(value)}
                  disabled={!canEdit || pending}
                  aria-invalid={Boolean(error)}
                  onChange={(event) => set(field, event.target.value)}
                  className={cn(error && 'border-destructive')}
                />
              )}

              {error ? <p className="text-nav text-destructive">{error}</p> : null}
            </div>
          )
        })}
      </dl>

      {canEdit ? (
        <Button
          size="sm"
          loading={pending}
          disabled={!dirty || Object.keys(errors).length > 0}
          onClick={save}
        >
          Save custom fields
        </Button>
      ) : null}
    </section>
  )
}
