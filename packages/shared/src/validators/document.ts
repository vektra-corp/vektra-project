import { z } from 'zod'
import { DOCUMENT_STATUSES } from '../constants/statuses'
import { richTextSchema, uuidSchema } from './common'

/**
 * Project document schemas (§6.3).
 *
 * `content` is a Tiptap document. Its shape is checked here; the body is
 * sanitized server-side before storage (§13.1), never on render.
 */

export const documentCreateSchema = z.object({
  project_id: uuidSchema,
  title: z.string().trim().min(1, 'Title is required').max(200),
  content: richTextSchema.nullable().optional(),
  status: z.enum(DOCUMENT_STATUSES).default('draft'),
})

export const documentUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200).optional(),
  content: richTextSchema.nullable().optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
})

/**
 * Restoring an older version.
 *
 * Applied as an ordinary content update so the snapshot trigger records the
 * restore as its own version — history stays append-only and the state you
 * replaced is never lost.
 */
export const documentRestoreSchema = z.object({
  document_id: uuidSchema,
  version: z.number().int().min(1),
})

export type DocumentCreateInput = z.infer<typeof documentCreateSchema>
export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>
