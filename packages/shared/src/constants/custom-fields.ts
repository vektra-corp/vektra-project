/**
 * Custom field behaviour (claude.md §6.7).
 *
 * The enums themselves live in statuses.ts alongside every other value that
 * mirrors a database CHECK constraint; this module holds the labels and the
 * coercion and validation rules that go with them.
 */
import type { CustomFieldType } from './statuses'

export const CUSTOM_FIELD_ENTITIES = [
  'task',
  'project',
  'contact',
  'commercial_document',
] as const
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number]

export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  task: 'Tasks',
  project: 'Projects',
  contact: 'Contacts',
  commercial_document: 'Commercial documents',
}

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  checkbox: 'Checkbox',
  url: 'URL',
  email: 'Email',
  currency: 'Currency',
}

export interface CustomFieldDefinition {
  id: string
  entity_type: CustomFieldEntity
  name: string
  field_type: CustomFieldType
  options: string[]
  is_required: boolean
  position: number
}

/**
 * Coerce a submitted value into the shape its field type stores.
 *
 * Values live in a single `jsonb` column across every field type, so the type
 * is the only thing that says how to read them. Returning `null` means "no
 * value" — which is distinct from a validation failure, reported separately by
 * `validateCustomValue`.
 */
export function coerceCustomValue(
  type: CustomFieldType,
  raw: unknown,
): string | number | boolean | null {
  if (type === 'checkbox') {
    // An unchecked box submits nothing at all, so absence is false, not null.
    return raw === true || raw === 'on' || raw === 'true'
  }

  const text = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw)
  if (text === '') return null

  if (type === 'number' || type === 'currency') {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
  }

  return text
}

export interface CustomValueError {
  fieldId: string
  message: string
}

/** Only http/https are ever stored for a URL field. */
function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Check one value against its definition.
 *
 * Deliberately not a Zod schema: the shape is decided at run time by the field
 * type, so a hand-written check reads better than a dynamically assembled one.
 */
export function validateCustomValue(
  field: CustomFieldDefinition,
  value: string | number | boolean | null,
): CustomValueError | null {
  const missing = value === null || value === ''

  if (field.is_required && missing && field.field_type !== 'checkbox') {
    return { fieldId: field.id, message: `${field.name} is required` }
  }
  if (missing) return null

  switch (field.field_type) {
    case 'number':
    case 'currency':
      return typeof value === 'number'
        ? null
        : { fieldId: field.id, message: `${field.name} must be a number` }

    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? null
        : { fieldId: field.id, message: `${field.name} must be a date` }

    case 'email':
      return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? null
        : { fieldId: field.id, message: `${field.name} must be an email address` }

    case 'url':
      return typeof value === 'string' && isSafeUrl(value)
        ? null
        : { fieldId: field.id, message: `${field.name} must be an http or https URL` }

    case 'dropdown':
      // A value outside the option list would render as a choice nobody can
      // reselect once the field is edited again.
      return typeof value === 'string' && field.options.includes(value)
        ? null
        : { fieldId: field.id, message: `${field.name} must be one of the listed options` }

    case 'text':
      return typeof value === 'string' && value.length <= 2000
        ? null
        : { fieldId: field.id, message: `${field.name} is too long` }

    default:
      return null
  }
}

/** Parse the stored `options` blob, tolerating anything that is not a string list. */
export function parseFieldOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}
