import type { ZodError, ZodSchema } from 'zod'
import { appError } from '../errors'

/**
 * RULE (§13.1): every user input passes through Zod BEFORE touching the database.
 * These helpers are the only sanctioned entry points, so no call site invents its
 * own error shape.
 */
export function validateInput<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw appError('VALIDATION_ERROR', formatZodMessage(result.error))
  }
  return result.data
}

/** Field-keyed errors for React Hook Form / useFormState. */
export function fieldErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form'
    const existing = errors[key]
    if (existing) existing.push(issue.message)
    else errors[key] = [issue.message]
  }
  return errors
}

function formatZodMessage(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join(', ')
}

/** Parse a FormData object with a schema, coercing empty strings to undefined. */
export function parseFormData<T>(schema: ZodSchema<T>, formData: FormData): T {
  const raw: Record<string, unknown> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && value === '') continue
    const existing = raw[key]
    if (existing === undefined) {
      raw[key] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      raw[key] = [existing, value]
    }
  }
  return validateInput(schema, raw)
}
