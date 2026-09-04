import { z } from 'zod'
import { dateStringSchema, uuidSchema } from './common'

/**
 * Time tracking (§19.1).
 *
 * `total_amount` is a generated column and `duration_minutes` is derived from
 * the clock whenever `end_time` is present, so neither is accepted from a
 * client on a timed entry.
 */

export const timerStartSchema = z.object({
  project_id: uuidSchema,
  task_id: uuidSchema.nullable().optional(),
  subtask_id: uuidSchema.nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  is_billable: z.boolean().default(true),
})

/**
 * A manual entry.
 *
 * Capped at 24 hours: anything longer is a typo or a forgotten timer, and
 * accepting it silently corrupts utilisation and invoicing.
 */
export const manualEntrySchema = z.object({
  project_id: uuidSchema,
  task_id: uuidSchema.nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  entry_date: dateStringSchema,
  duration_minutes: z
    .number()
    .int()
    .positive('Enter a duration greater than zero')
    .max(24 * 60, 'A single entry cannot exceed 24 hours'),
  is_billable: z.boolean().default(true),
  hourly_rate: z.number().min(0).max(100000).nullable().optional(),
})

export const timeEntryUpdateSchema = z.object({
  description: z.string().trim().max(500).nullable().optional(),
  duration_minutes: z.number().int().positive().max(24 * 60).optional(),
  is_billable: z.boolean().optional(),
  hourly_rate: z.number().min(0).max(100000).nullable().optional(),
})

export const timesheetSubmitSchema = z.object({
  period_start: dateStringSchema,
  period_end: dateStringSchema,
})

export type ManualEntryInput = z.infer<typeof manualEntrySchema>
