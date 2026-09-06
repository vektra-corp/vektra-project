import { z } from 'zod'
import {
  PRIORITIES,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  PROJECT_VISIBILITY,
} from '../constants/statuses'
import { dateStringSchema, hexColorSchema, uuidSchema } from './common'

/**
 * The project key — the front identifier people type and read.
 *
 * Two to ten characters, starting with a letter, uppercase alphanumerics only.
 * The narrowness is the point: the key is concatenated into a task reference
 * ("VEK-241"), so a key containing a hyphen or consisting only of digits would
 * make that reference ambiguous both to read and to parse. Input is upper-cased
 * rather than rejected for case, because nobody wants a form error for typing
 * "vek". The same rule exists as a CHECK constraint in migration 00034;
 * uniqueness within the organization is a unique index, and surfaces here as a
 * field error rather than a crash.
 */
export const projectKeySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(
    z
      .string()
      .min(2, 'Use at least 2 characters')
      .max(10, 'Use at most 10 characters')
      .regex(/^[A-Z][A-Z0-9]*$/, 'Start with a letter; letters and digits only'),
  )

export const projectCreateSchema = z
  .object({
    workspace_id: uuidSchema,
    name: z.string().trim().min(1, 'Project name is required').max(150),
    // Optional on create: left out, the server derives one from the name.
    key: projectKeySchema.optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(PROJECT_STATUSES).default('active'),
    priority: z.enum(PRIORITIES).nullable().default('medium'),
    start_date: dateStringSchema.nullable().optional(),
    end_date: dateStringSchema.nullable().optional(),
    budget: z.number().nonnegative().max(9_999_999_999).nullable().optional(),
    visibility: z.enum(PROJECT_VISIBILITY).default('workspace'),
  })
  .refine(
    (data) => !data.start_date || !data.end_date || data.start_date <= data.end_date,
    { message: 'End date must be on or after the start date', path: ['end_date'] },
  )

export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    key: projectKeySchema.optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    priority: z.enum(PRIORITIES).nullable().optional(),
    start_date: dateStringSchema.nullable().optional(),
    end_date: dateStringSchema.nullable().optional(),
    budget: z.number().nonnegative().max(9_999_999_999).nullable().optional(),
    visibility: z.enum(PROJECT_VISIBILITY).optional(),
  })
  .refine(
    (data) => !data.start_date || !data.end_date || data.start_date <= data.end_date,
    { message: 'End date must be on or after the start date', path: ['end_date'] },
  )

export const projectMemberSchema = z.object({
  project_id: uuidSchema,
  user_id: uuidSchema,
  role: z.enum(PROJECT_ROLES).default('contributor'),
})

export const kanbanColumnCreateSchema = z.object({
  board_id: uuidSchema,
  name: z.string().trim().min(1, 'Column name is required').max(60),
  color: hexColorSchema.nullable().optional(),
  position: z.number().int().min(0).default(0),
  wip_limit: z.number().int().min(1).max(999).nullable().optional(),
  is_done_column: z.boolean().default(false),
})

export const kanbanColumnUpdateSchema = kanbanColumnCreateSchema.partial().omit({ board_id: true })

export const labelCreateSchema = z.object({
  project_id: uuidSchema.nullable().optional(),
  name: z.string().trim().min(1, 'Label name is required').max(40),
  color: hexColorSchema,
})

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>
export type KanbanColumnCreateInput = z.infer<typeof kanbanColumnCreateSchema>
export type LabelCreateInput = z.infer<typeof labelCreateSchema>
