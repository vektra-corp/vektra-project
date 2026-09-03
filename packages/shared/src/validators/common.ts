import { z } from 'zod'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../types/common'

/** Reusable field schemas so validation rules are defined once. */

export const uuidSchema = z.string().uuid('Invalid identifier')

/** Postgres `date` column: a calendar date with no timezone. */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a real date')

export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour like #4F46E5')

export const currencyCodeSchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code')

export const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}, 'Unknown timezone')

/** Tiptap JSON document. Structure is validated, content sanitized separately. */
export const richTextSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    text: z.string().optional(),
    attrs: z.record(z.unknown()).optional(),
    marks: z
      .array(z.object({ type: z.string(), attrs: z.record(z.unknown()).optional() }))
      .optional(),
    content: z.array(richTextSchema).optional(),
  }),
)

export const cursorPaginationSchema = z.object({
  cursor: z.string().nullish(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

/** Inclusive date range used by reports and dashboard widgets. */
export const dateRangeSchema = z
  .object({
    from: dateStringSchema,
    to: dateStringSchema,
  })
  .refine((range) => range.from <= range.to, {
    message: 'Start date must be on or before end date',
    path: ['to'],
  })

export const sortOrderSchema = z.enum(['asc', 'desc']).default('asc')

export const addressSchema = z.object({
  street: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zip: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
})
