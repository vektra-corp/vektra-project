import type { OrgRole } from '@pm/shared/constants'
import { COLUMNS, type Db, unwrap, unwrapList, unwrapMaybe } from '../helpers'

/**
 * Organization and membership reads.
 *
 * Every query here relies on RLS for tenant filtering rather than adding a
 * redundant `.eq('organization_id', ...)`. The exception is where a query spans
 * organizations on purpose, such as the org switcher.
 */

export interface OrgListItem {
  id: string
  name: string
  slug: string
  logo_url: string | null
  status: string
  role: OrgRole
}

/** Every organization the signed-in user belongs to, for the org switcher. */
export async function listMyOrganizations(db: Db, userId: string): Promise<OrgListItem[]> {
  const rows = unwrapList(
    await db
      .from('org_members')
      .select('role, is_default, organization:organizations(id, name, slug, logo_url, status)')
      .eq('user_id', userId)
      .order('is_default', { ascending: false }),
  )

  return rows.flatMap((row) => {
    const org = row.organization as unknown as {
      id: string
      name: string
      slug: string
      logo_url: string | null
      status: string
    } | null
    if (!org) return []
    return [{ ...org, role: row.role as OrgRole }]
  })
}

export async function getOrganizationBySlug(db: Db, slug: string) {
  return unwrapMaybe(
    await db
      .from('organizations')
      .select(
        'id, name, slug, logo_url, currency, timezone, settings, status, plan_id, trial_ends_at',
      )
      .eq('slug', slug)
      .maybeSingle(),
  )
}

export async function getOrganization(db: Db, orgId: string) {
  return unwrap(
    await db
      .from('organizations')
      .select(
        'id, name, slug, logo_url, address, billing_email, tax_id, currency, timezone, settings, status, plan_id, trial_ends_at, stripe_customer_id',
      )
      .eq('id', orgId)
      .single(),
  )
}

/**
 * The user's role in an organization, read from the membership table rather
 * than the JWT so a role change takes effect without waiting for a refresh.
 */
export async function getMembership(db: Db, orgId: string, userId: string) {
  return unwrapMaybe(
    await db
      .from('org_members')
      .select('id, role, branch_id, is_default, joined_at')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle(),
  )
}

export async function listMembers(db: Db, orgId: string) {
  return unwrapList(
    await db
      .from('org_members')
      .select(`id, role, branch_id, joined_at, profile:profiles!inner(${COLUMNS.profileSummary})`)
      .eq('organization_id', orgId)
      .order('joined_at', { ascending: true }),
  )
}

export async function listWorkspaces(db: Db, orgId: string) {
  return unwrapList(
    await db
      .from('workspaces')
      .select(COLUMNS.workspaceListItem)
      .eq('organization_id', orgId)
      .order('name'),
  )
}

export async function getWorkspaceBySlug(db: Db, orgId: string, slug: string) {
  return unwrapMaybe(
    await db
      .from('workspaces')
      .select('id, name, slug, description, color, icon')
      .eq('organization_id', orgId)
      .eq('slug', slug)
      .maybeSingle(),
  )
}

/** Plan name for an org, used for feature gating. */
export async function getPlanName(db: Db, orgId: string): Promise<string | null> {
  const row = unwrapMaybe(
    await db.from('organizations').select('plan:plans!organizations_plan_id_fkey(name)').eq('id', orgId).maybeSingle(),
  )
  const plan = row?.plan as unknown as { name: string } | null
  return plan?.name ?? null
}

/** Current usage against limits, for the billing page and quota warnings. */
export async function getUsage(db: Db, orgId: string) {
  return unwrapList(
    await db
      .from('usage_counters')
      .select('metric, current_value, limit_value, period_start, period_end')
      .eq('organization_id', orgId),
  )
}
