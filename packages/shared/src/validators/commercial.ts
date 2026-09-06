import { z } from 'zod'
import {
  COMMERCIAL_DOC_TYPES,
  COMMERCIAL_STATUSES,
  CONTACT_TYPES,
  type CommercialDocType,
} from '../constants/statuses'
import { addressSchema, currencyCodeSchema, dateStringSchema, uuidSchema } from './common'

/**
 * Commercial document schemas (§6.4, §19.2).
 *
 * Derived money — line_total, subtotal, tax_total, grand_total — is deliberately
 * absent from every schema here. Those columns are computed by database triggers
 * and revoked from end-user roles, so a client that submits them is submitting
 * something that will be ignored; leaving them out makes that explicit.
 */

export const contactCreateSchema = z.object({
  type: z.enum(CONTACT_TYPES).default('client'),
  company_name: z.string().trim().max(150).nullable().optional(),
  contact_name: z.string().trim().min(1, 'Contact name is required').max(150),
  email: z.string().trim().email('Enter a valid email address').nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(40).nullable().optional(),
  address: addressSchema.nullable().optional(),
  tax_id: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export const contactUpdateSchema = contactCreateSchema.partial()

export const lineItemSchema = z.object({
  id: uuidSchema.optional(),
  description: z.string().trim().min(1, 'Description is required').max(500),
  quantity: z.number().min(0, 'Quantity cannot be negative').max(1_000_000),
  unit_price: z.number().min(0, 'Price cannot be negative').max(100_000_000),
  tax_rate: z.number().min(0).max(100, 'Tax rate is a percentage').default(0),
  discount: z.number().min(0).max(100_000_000).default(0),
  position: z.number().int().min(0).default(0),
})

export const commercialDocCreateSchema = z.object({
  doc_type: z.enum(COMMERCIAL_DOC_TYPES),
  workspace_id: uuidSchema,
  project_id: uuidSchema.nullable().optional(),
  contact_id: uuidSchema.nullable().optional(),
  issue_date: dateStringSchema,
  due_date: dateStringSchema.nullable().optional(),
  valid_until: dateStringSchema.nullable().optional(),
  currency: currencyCodeSchema.default('USD'),
  notes: z.string().trim().max(4000).nullable().optional(),
  terms: z.string().trim().max(4000).nullable().optional(),
  line_items: z.array(lineItemSchema).max(200).default([]),
})

export const commercialDocUpdateSchema = commercialDocCreateSchema
  .partial()
  .omit({ doc_type: true, workspace_id: true })

/**
 * A status transition.
 *
 * The legal set differs per document type and is enforced by a CHECK constraint
 * as well; validating here turns a constraint violation into a message that
 * names the type.
 */
export function statusSchemaFor(docType: CommercialDocType) {
  const allowed = COMMERCIAL_STATUSES[docType] as readonly string[]
  return z.object({
    status: z.string().refine((value) => allowed.includes(value), {
      message: `Not a valid status for a ${docType.replace('_', ' ')}`,
    }),
  })
}

export type ContactCreateInput = z.infer<typeof contactCreateSchema>
// `LineItemInput` is already the calculator's input shape in utils/currency;
// this is the validated wire form, so it carries the module in its name.
export type CommercialLineItemInput = z.infer<typeof lineItemSchema>
export type CommercialDocCreateInput = z.infer<typeof commercialDocCreateSchema>
