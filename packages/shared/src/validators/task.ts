import { z } from 'zod'
import { DEPENDENCY_TYPES, PRIORITIES, TASK_STATUSES } from '../constants/statuses'
import { dateStringSchema, richTextSchema, uuidSchema } from './common'

const hoursSchema = z.number().min(0).max(9999).nullable().optional()

export const taskCreateSchema = z
  .object({
    project_id: uuidSchema,
    kanban_column_id: uuidSchema.nullable().optional(),
    title: z.string().trim().min(1, 'Task title is required').max(300),
    description: richTextSchema.nullable().optional(),
    status: z.enum(TASK_STATUSES).default('todo'),
    priority: z.enum(PRIORITIES).default('medium'),
    assignee_id: uuidSchema.nullable().optional(),
    start_date: dateStringSchema.nullable().optional(),
    due_date: dateStringSchema.nullable().optional(),
    estimated_hours: hoursSchema,
    is_milestone: z.boolean().default(false),
    label_ids: z.array(uuidSchema).max(20).default([]),
  })
  .refine((data) => !data.start_date || !data.due_date || data.start_date <= data.due_date, {
    message: 'Due date must be on or after the start date',
    path: ['due_date'],
  })

export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: richTextSchema.nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assignee_id: uuidSchema.nullable().optional(),
    start_date: dateStringSchema.nullable().optional(),
    due_date: dateStringSchema.nullable().optional(),
    estimated_hours: hoursSchema,
    actual_hours: hoursSchema,
    is_milestone: z.boolean().optional(),
    label_ids: z.array(uuidSchema).max(20).optional(),
  })
  .refine((data) => !data.start_date || !data.due_date || data.start_date <= data.due_date, {
    message: 'Due date must be on or after the start date',
    path: ['due_date'],
  })

/**
 * Kanban drag payload. Column and status move together — there is no way to set
 * one without the other (claude.md §18 rule 3); the server derives status from
 * the target column.
 */
export const taskMoveSchema = z.object({
  task_id: uuidSchema,
  target_column_id: uuidSchema,
  position: z.number().finite(),
})

/** Same shape as a task move; the subtask board shares the column semantics. */
export const subtaskMoveSchema = z.object({
  subtask_id: uuidSchema,
  target_column_id: uuidSchema,
  position: z.number().finite(),
})

export const subtaskCreateSchema = z.object({
  task_id: uuidSchema,
  kanban_column_id: uuidSchema.nullable().optional(),
  title: z.string().trim().min(1, 'Subtask title is required').max(300),
  description: richTextSchema.nullable().optional(),
  status: z.enum(TASK_STATUSES).default('todo'),
  priority: z.enum(PRIORITIES).default('medium'),
  assignee_id: uuidSchema.nullable().optional(),
  due_date: dateStringSchema.nullable().optional(),
  estimated_hours: hoursSchema,
})

export const subtaskUpdateSchema = subtaskCreateSchema.partial().omit({ task_id: true })

export const taskDependencySchema = z
  .object({
    predecessor_id: uuidSchema,
    successor_id: uuidSchema,
    dependency_type: z.enum(DEPENDENCY_TYPES).default('finish_to_start'),
    lag_days: z.number().int().min(-365).max(365).default(0),
  })
  .refine((data) => data.predecessor_id !== data.successor_id, {
    message: 'A task cannot depend on itself',
    path: ['successor_id'],
  })

export const commentCreateSchema = z
  .object({
    task_id: uuidSchema.nullable().optional(),
    subtask_id: uuidSchema.nullable().optional(),
    document_id: uuidSchema.nullable().optional(),
    parent_id: uuidSchema.nullable().optional(),
    body: richTextSchema,
    is_internal: z.boolean().default(false),
    /** User ids extracted from @mentions, used to fan out notifications. */
    mention_ids: z.array(uuidSchema).max(50).default([]),
  })
  .refine(
    (data) =>
      [data.task_id, data.subtask_id, data.document_id].filter(Boolean).length === 1,
    { message: 'A comment must belong to exactly one parent' },
  )

export type TaskCreateInput = z.infer<typeof taskCreateSchema>
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>
export type TaskMoveInput = z.infer<typeof taskMoveSchema>
export type SubtaskMoveInput = z.infer<typeof subtaskMoveSchema>
export type SubtaskCreateInput = z.infer<typeof subtaskCreateSchema>
export type CommentCreateInput = z.infer<typeof commentCreateSchema>
