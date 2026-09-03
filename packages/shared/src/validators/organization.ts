import { z } from 'zod'
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

export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>
export type WorkspaceUpdateInput = z.infer<typeof workspaceUpdateSchema>
