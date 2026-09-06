import type { DateFormat, Locale, TimeFormat } from '../constants/locales'
import type { PlanTier } from '../constants/plans'
import type { OrgRole, OrgStatus, WorkspaceRole } from '../constants/statuses'
import type { Address, Timestamps, UUID, UserSummary } from './common'

/** Shape of `organizations.settings` jsonb. */
export interface OrgSettings {
  locale?: Locale
  date_format?: DateFormat
  time_format?: TimeFormat
  timezone?: string
  currency?: string
  /** Month number the fiscal year starts in, 1-12. */
  fiscal_year_start?: number
  /** Enterprise: require every member to enrol in TOTP (§13.5). */
  enforce_mfa?: boolean
  /** Minutes of inactivity before forced re-auth (§13.6). */
  session_idle_timeout_minutes?: number
  /** Enterprise: cap simultaneous sessions per user. null = unlimited. */
  max_concurrent_sessions?: number | null
  /** `yyyy-MM-dd` dates excluded from leave duration (§19.5). */
  public_holidays?: string[]
}

/** Shape of `profiles.settings` jsonb. */
export interface ProfileSettings {
  locale?: Locale
  date_format?: DateFormat
  time_format?: TimeFormat
  timezone?: string
  /** Sidebar, theme, and other per-user UI preferences. */
  theme?: 'light' | 'dark' | 'system'
}

export interface Organization extends Timestamps {
  id: UUID
  name: string
  slug: string
  logo_url: string | null
  address: Address | null
  billing_email: string | null
  tax_id: string | null
  currency: string
  timezone: string
  settings: OrgSettings
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan_id: UUID | null
  trial_ends_at: string | null
  status: OrgStatus
}

export interface Profile extends Timestamps {
  id: UUID
  full_name: string
  avatar_url: string | null
  phone: string | null
  timezone: string | null
  settings: ProfileSettings
}

export interface OrgMember {
  id: UUID
  organization_id: UUID
  user_id: UUID
  role: OrgRole
  branch_id: UUID | null
  is_default: boolean
  joined_at: string
}

export interface OrgMemberWithProfile extends OrgMember {
  profile: UserSummary
}

export interface Workspace extends Timestamps {
  id: UUID
  organization_id: UUID
  name: string
  slug: string
  description: string | null
  color: string | null
  icon: string | null
  created_by: UUID | null
}

export interface WorkspaceMember {
  id: UUID
  workspace_id: UUID
  user_id: UUID
  organization_id: UUID
  role: WorkspaceRole
  joined_at: string
}

/** Resolved tenant context for the current request. Built once in middleware. */
export interface OrgContext {
  organization: Pick<Organization, 'id' | 'name' | 'slug' | 'status' | 'timezone' | 'currency'>
  plan: PlanTier
  role: OrgRole
  user: UserSummary
}
