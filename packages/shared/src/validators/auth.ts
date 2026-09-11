import { z } from 'zod'
import { SUPPORTED_LOCALES } from '../constants/locales'
import { isValidSlug } from '../utils/slug'

/**
 * Auth and onboarding schemas. Shared verbatim between client forms and server
 * actions (§3) so the two can never drift.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254)
  .email('Enter a valid email address')
  .transform((value) => value.toLowerCase())

/**
 * Minimum 8 characters per §13.5. Breach checking against haveibeenpwned is
 * handled by Supabase Auth config, not here — this is only the shape check.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')

export const signupSchema = z
  .object({
    full_name: z.string().trim().min(1, 'Name is required').max(120),
    email: emailSchema,
    password: passwordSchema,
    confirm_password: z.string(),
    organization_name: z.string().trim().min(1, 'Organization name is required').max(120),
    accept_terms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms to continue' }),
    }),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
})

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm_password: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })

export const orgSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug must be at least 2 characters')
  .max(48)
  .refine(isValidSlug, 'Use lowercase letters, numbers and hyphens only')

export const localeSchema = z.enum(SUPPORTED_LOCALES)

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'manager', 'member']),
  workspace_ids: z.array(z.string().uuid()).default([]),
  /**
   * Projects to put them straight into. A workspace grant alone lets someone see
   * the workspace; project membership is what RLS reads to let them open a
   * board, so an invite that names no project lands the person in an empty app.
   */
  project_ids: z.array(z.string().uuid()).default([]),
})

/** Editing an existing member's workspace and project access after the fact. */
export const memberAccessSchema = z.object({
  user_id: z.string().uuid(),
  workspace_ids: z.array(z.string().uuid()).default([]),
  project_ids: z.array(z.string().uuid()).default([]),
})

export const otpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>
export type MemberAccessInput = z.infer<typeof memberAccessSchema>
