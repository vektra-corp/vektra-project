import { z } from 'zod'
import {
  PRIORITIES,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  PROJECT_VISIBILITY,
} from '../constants/statuses'
import { dateStringSchema, hexColorSchema, uuidSchema } from './common'

export const projectCreateSchema = z
  .object({
    workspace_id: uuidSchema,
    name: z.string().trim().min(1, 'Project name is required').max(150),
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
