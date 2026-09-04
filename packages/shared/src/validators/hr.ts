import { z } from 'zod'
import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  LEAVE_REQUEST_STATUSES,
} from '../constants/statuses'
import { dateStringSchema, hexColorSchema, uuidSchema } from './common'

/**
 * Employee and leave schemas (§19.5).
 *
 * Date ranges are validated here as well as in the database: the CHECK
 * constraint is the guarantee, this is the message a person can act on.
 */

export const employeeCreateSchema = z.object({
  user_id: uuidSchema,
  employee_code: z.string().trim().max(40).nullable().optional(),
  department: z.string().trim().max(80).nullable().optional(),
  designation: z.string().trim().max(80).nullable().optional(),
  employment_type: z.enum(EMPLOYMENT_TYPES).default('full_time'),
  date_of_joining: dateStringSchema,
  date_of_exit: dateStringSchema.nullable().optional(),
  manager_id: uuidSchema.nullable().optional(),
  default_hourly_rate: z.number().min(0).max(100000).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  status: z.enum(EMPLOYEE_STATUSES).default('active'),
})

export const employeeUpdateSchema = employeeCreateSchema.partial().omit({ user_id: true })

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  color: hexColorSchema.nullable().optional(),
  default_days: z.number().min(0).max(365).default(0),
  is_paid: z.boolean().default(true),
  requires_approval: z.boolean().default(true),
  is_active: z.boolean().default(true),
})

/**
 * A leave request.
 *
 * `duration_days` is supplied rather than derived because half-days are
 * supported and public holidays are excluded, neither of which the date range
 * alone can express.
 */
export const leaveRequestSchema = z
  .object({
    leave_type_id: uuidSchema,
    start_date: dateStringSchema,
    end_date: dateStringSchema,
    duration_days: z.number().positive('Duration must be more than zero').max(365),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((data) => data.start_date <= data.end_date, {
    message: 'Leave cannot end before it starts',
    path: ['end_date'],
  })
  .refine(
    (data) => {
      // A request can be shorter than its span (half-days, holidays) but never
      // longer — that would mean claiming days the range does not contain.
      const start = Date.parse(data.start_date)
      const end = Date.parse(data.end_date)
      const span = Math.round((end - start) / 86_400_000) + 1
      return data.duration_days <= span
    },
    { message: 'Duration is longer than the dates selected', path: ['duration_days'] },
  )

export const leaveDecisionSchema = z.object({
  request_id: uuidSchema,
  status: z.enum(LEAVE_REQUEST_STATUSES).refine(
    (status) => status === 'approved' || status === 'rejected',
    'A decision is either approved or rejected',
  ),
  rejection_note: z.string().trim().max(500).nullable().optional(),
})

export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>
