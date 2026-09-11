import { z } from 'zod'
import { GSTIN_PATTERN, isBillingCountry, isGstStateCode } from '../constants/billing-geography'
import { DATE_FORMATS, SUPPORTED_LOCALES, TIME_FORMATS } from '../constants/locales'
import { ORG_ROLES, WORKSPACE_ROLES } from '../constants/statuses'
import { isValidSlug } from '../utils/slug'
import {
  addressSchema,
  currencyCodeSchema,
  hexColorSchema,
  timezoneSchema,
  uuidSchema,
} from './common'

export const orgSettingsSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  date_format: z.enum(DATE_FORMATS).optional(),
  time_format: z.enum(TIME_FORMATS).optional(),
  timezone: timezoneSchema.optional(),
  currency: currencyCodeSchema.optional(),
  fiscal_year_start: z.number().int().min(1).max(12).optional(),
  enforce_mfa: z.boolean().optional(),
  session_idle_timeout_minutes: z.number().int().min(5).max(1440).optional(),
  max_concurrent_sessions: z.number().int().min(1).max(50).nullable().optional(),
  public_holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  /**
   * Delegate workspace creation to managers.
   *
   * Read by `can_create_workspace()` (migration 00045) as well as by the UI, so
   * the database and the button agree on who may.
   */
  managers_can_create_workspaces: z.boolean().optional(),
})

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(48)
    .refine(isValidSlug, 'Use lowercase letters, numbers and hyphens only'),
  currency: currencyCodeSchema.default('USD'),
  timezone: timezoneSchema.default('UTC'),
})

export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  logo_url: z.string().url().nullable().optional(),
  address: addressSchema.nullable().optional(),
  billing_email: z.string().email().nullable().optional(),
  tax_id: z.string().max(60).nullable().optional(),
  currency: currencyCodeSchema.optional(),
  timezone: timezoneSchema.optional(),
  settings: orgSettingsSchema.optional(),
})

export const profileUpdateSchema = z.object({
  full_name: z.string().trim().min(1, 'Name is required').max(120).optional(),
  avatar_url: z.string().url().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  timezone: timezoneSchema.nullable().optional(),
  settings: z
    .object({
      locale: z.enum(SUPPORTED_LOCALES).optional(),
      date_format: z.enum(DATE_FORMATS).optional(),
      time_format: z.enum(TIME_FORMATS).optional(),
      timezone: timezoneSchema.optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
    })
    .optional(),
})

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1, 'Workspace name is required').max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(48)
    .refine(isValidSlug, 'Use lowercase letters, numbers and hyphens only'),
  description: z.string().max(1000).nullable().optional(),
  color: hexColorSchema.nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
})

export const workspaceUpdateSchema = workspaceCreateSchema.partial().omit({ slug: true })

export const memberRoleUpdateSchema = z.object({
  user_id: uuidSchema,
  /** Ownership transfer is a separate, confirmed flow — not a role edit. */
  role: z.enum(ORG_ROLES).refine((role) => role !== 'owner', 'Transfer ownership separately'),
})

export const workspaceMemberSchema = z.object({
  workspace_id: uuidSchema,
  user_id: uuidSchema,
  role: z.enum(WORKSPACE_ROLES).default('member'),
})


/**
 * The billing profile: country, Indian state, and GSTIN.
 *
 * Validated here to the same rules the database enforces as CHECKs, so a bad
 * value is a field error on a form rather than a 23514 the user cannot read.
 * The three cross-field rules are the ones that actually change money:
 *
 *  - An Indian org must name its state, because without one the place of supply
 *    falls back to the seller's and every invoice silently becomes intra-state.
 *  - A GSTIN's first two digits ARE a state code, so a GSTIN disagreeing with
 *    the selected state is the exact input that flips CGST+SGST into IGST.
 *  - A GSTIN outside India is meaningless and is refused rather than ignored.
 */
export const billingProfileSchema = z
  .object({
    billing_country: z.string().refine(isBillingCountry, 'Select a billing country'),
    billing_state: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((v) => v || null),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .nullable()
      .optional()
      .transform((v) => v || null),
  })
  .superRefine((value, ctx) => {
    const isIndia = value.billing_country === 'IN'

    if (isIndia && !value.billing_state) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billing_state'],
        message: 'Select your state — it decides the GST split on your invoices',
      })
    }

    if (value.billing_state && !isGstStateCode(value.billing_state)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billing_state'],
        message: 'Not a valid GST state code',
      })
    }

    if (!isIndia && value.billing_state) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billing_state'],
        message: 'A GST state applies to Indian billing only',
      })
    }

    if (value.gstin) {
      if (!isIndia) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gstin'],
          message: 'A GSTIN applies to Indian billing only',
        })
      } else if (!GSTIN_PATTERN.test(value.gstin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gstin'],
          message: 'That is not a valid GSTIN',
        })
      } else if (value.billing_state && value.gstin.slice(0, 2) !== value.billing_state) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gstin'],
          message: 'This GSTIN belongs to a different state than the one selected',
        })
      }
    }
  })

export type BillingProfileInput = z.infer<typeof billingProfileSchema>

export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>
export type WorkspaceUpdateInput = z.infer<typeof workspaceUpdateSchema>
