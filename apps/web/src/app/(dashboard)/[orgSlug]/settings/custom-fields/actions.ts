'use server'

import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/** Custom field definitions (§6.7). Admin-only, matching the RLS policy. */

function fieldsPath(orgSlug: string) {
  return `/${orgSlug}/settings/custom-fields`
}

export async function saveCustomField(
  orgSlug: string,
  fieldId: string | null,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only admins can manage custom fields.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Name is required',
      fieldErrors: { name: ['Name is required'] },
    }
  }

  const entityType = String(formData.get('entity_type') ?? '')
  const fieldType = String(formData.get('field_type') ?? '')

  if (!(CUSTOM_FIELD_ENTITIES as readonly string[]).includes(entityType)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown entity type.' }
  }
  if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(fieldType)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown field type.' }
  }

  const options = String(formData.get('options') ?? '')
    .split('\n')
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, 50)

  // A dropdown with nothing to drop down is a field nobody can fill in.
  if (fieldType === 'dropdown' && options.length === 0) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'A dropdown needs at least one option.',
      fieldErrors: { options: ['Add at least one option.'] },
    }
  }

  const supabase = createClient()

  try {
    const payload = {
      entity_type: entityType as CustomFieldEntity,
      name: name.slice(0, 80),
      field_type: fieldType as CustomFieldType,
      options: (fieldType === 'dropdown' ? options : null) as never,
      is_required: formData.get('is_required') === 'on',
      position: Number(formData.get('position')) || 0,
    }

    if (fieldId) {
      // The field type and entity are not editable: existing values are
      // stored under the old type's shape, and changing either would
      // reinterpret them silently. Destructured out with the underscore prefix
      // the lint config reserves for deliberate discards.
      const { entity_type: _entityType, field_type: _fieldType, ...editable } = payload
      const { error } = await supabase
        .from('custom_fields')
        .update(editable)
        .eq('id', fieldId)
        .eq('organization_id', auth.orgId)
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('custom_fields')
        .insert({ ...payload, organization_id: auth.orgId })
      if (error) {
        if (error.code === '23505') {
          return {
            ok: false,
            code: 'ALREADY_EXISTS',
            message: 'A field with that name already exists for this entity.',
            fieldErrors: { name: ['Already used for this entity.'] },
          }
        }
        throw error
      }
    }

    revalidatePath(fieldsPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteCustomField(
  orgSlug: string,
  fieldId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only admins can manage custom fields.' }
  }

  const supabase = createClient()

  try {
    // custom_field_values cascades, so deleting a field discards every value
    // ever entered for it. Say how many rather than doing it silently — the
    // caller has already confirmed, but the count is in the dialog.
    const { error } = await supabase
      .from('custom_fields')
      .delete()
      .eq('id', fieldId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(fieldsPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Write the custom field values for one entity.
 *
 * Called from the entity's own form (a task, a project), not from settings.
 * Values are upserted per field so a partial form does not clear fields it did
 * not render.
 */
export async function saveCustomValues(
  orgSlug: string,
  entityType: CustomFieldEntity,
  entityId: string,
  values: Record<string, string | number | boolean | null>,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  const supabase = createClient()

  try {
    const { data: fields } = await supabase
      .from('custom_fields')
      .select('id')
      .eq('organization_id', auth.orgId)
      .eq('entity_type', entityType)

    const known = new Set((fields ?? []).map((field) => field.id))
    // A field id from another entity type — or another tenant — is not writable
    // here, whatever the form claimed.
    const rows = Object.entries(values)
      .filter(([fieldId]) => known.has(fieldId))
      .map(([fieldId, value]) => ({
        custom_field_id: fieldId,
        organization_id: auth.orgId,
        entity_id: entityId,
        value: (value ?? null) as never,
      }))

    if (rows.length === 0) return { ok: true, data: null }

    const { error } = await supabase
      .from('custom_field_values')
      .upsert(rows, { onConflict: 'custom_field_id,entity_id' })

    if (error) throw error

    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
