import type { Database } from '@pm/db/types'
import {
  parseFieldOptions,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from '@pm/shared/constants'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Load the custom-field definitions and values for one record (§6.7).
 *
 * Every entity that supports custom fields needs the same two queries and the
 * same normalisation, so it lives here rather than in four page components.
 *
 * `custom_field_values.value` is a single jsonb column shared by every field
 * type, which means the definition's `field_type` is the only thing that says
 * how to read it. Nothing is interpreted here — the raw value is handed to the
 * inputs, which coerce and validate through the shared helpers the server also
 * uses.
 */

export type CustomValue = string | number | boolean | null

export interface LoadedCustomFields {
  fields: CustomFieldDefinition[]
  values: Record<string, CustomValue>
}

export async function loadCustomFields(
  supabase: SupabaseClient<Database>,
  orgId: string,
  entityType: CustomFieldEntity,
  entityId: string,
): Promise<LoadedCustomFields> {
  const [{ data: definitions }, { data: values }] = await Promise.all([
    supabase
      .from('custom_fields')
      .select('id, entity_type, name, field_type, options, is_required, position')
      .eq('organization_id', orgId)
      .eq('entity_type', entityType)
      .order('position'),
    supabase
      .from('custom_field_values')
      .select('custom_field_id, value')
      .eq('organization_id', orgId)
      .eq('entity_id', entityId),
  ])

  const fields: CustomFieldDefinition[] = (definitions ?? []).map((field) => ({
    id: field.id,
    entity_type: entityType,
    name: field.name,
    field_type: field.field_type as CustomFieldDefinition['field_type'],
    options: parseFieldOptions(field.options),
    is_required: field.is_required,
    position: field.position,
  }))

  const byField: Record<string, CustomValue> = {}
  for (const row of values ?? []) {
    byField[row.custom_field_id] = (row.value ?? null) as CustomValue
  }

  return { fields, values: byField }
}

/**
 * The same thing for a list of records, in two queries rather than 2N.
 *
 * A list page that called `loadCustomFields` per row would issue two round
 * trips per contact. The definitions are shared across every row, and the
 * values come back in one `in` query and are grouped here.
 */
export async function loadCustomFieldsForMany(
  supabase: SupabaseClient<Database>,
  orgId: string,
  entityType: CustomFieldEntity,
  entityIds: string[],
): Promise<{ fields: CustomFieldDefinition[]; valuesByEntity: Record<string, Record<string, CustomValue>> }> {
  const [{ data: definitions }, { data: values }] = await Promise.all([
    supabase
      .from('custom_fields')
      .select('id, entity_type, name, field_type, options, is_required, position')
      .eq('organization_id', orgId)
      .eq('entity_type', entityType)
      .order('position'),
    entityIds.length > 0
      ? supabase
          .from('custom_field_values')
          .select('custom_field_id, entity_id, value')
          .eq('organization_id', orgId)
          .in('entity_id', entityIds)
      : Promise.resolve({ data: [] as { custom_field_id: string; entity_id: string; value: unknown }[] }),
  ])

  const fields: CustomFieldDefinition[] = (definitions ?? []).map((field) => ({
    id: field.id,
    entity_type: entityType,
    name: field.name,
    field_type: field.field_type as CustomFieldDefinition['field_type'],
    options: parseFieldOptions(field.options),
    is_required: field.is_required,
    position: field.position,
  }))

  const valuesByEntity: Record<string, Record<string, CustomValue>> = {}
  for (const row of values ?? []) {
    const bucket = (valuesByEntity[row.entity_id] ??= {})
    bucket[row.custom_field_id] = (row.value ?? null) as CustomValue
  }

  return { fields, valuesByEntity }
}
