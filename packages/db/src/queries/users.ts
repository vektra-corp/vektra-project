import { COLUMNS, type Db, unwrap, unwrapList, unwrapMaybe } from '../helpers'
import type { TablesUpdate } from '../types'

export async function getProfile(db: Db, userId: string) {
  return unwrapMaybe(
    await db
      .from('profiles')
      .select('id, full_name, avatar_url, phone, timezone, settings')
      .eq('id', userId)
      .maybeSingle(),
  )
}

export async function updateProfile(db: Db, userId: string, patch: TablesUpdate<'profiles'>) {
  return unwrap(
    await db
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('id, full_name, avatar_url, phone, timezone, settings')
      .single(),
  )
}

/** Profiles for an assignee picker — everyone in the org, name-ordered. */
export async function listAssignableUsers(db: Db, orgId: string) {
  const rows = unwrapList(
    await db
      .from('org_members')
      .select(`profile:profiles!inner(${COLUMNS.profileSummary})`)
      .eq('organization_id', orgId),
  )

  return rows
    .flatMap((row) => {
      const profile = row.profile as unknown as {
        id: string
        full_name: string
        avatar_url: string | null
      } | null
      return profile ? [profile] : []
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

/** Active sessions for the account settings page (§13.6). */
export async function listSessions(db: Db, userId: string) {
  return unwrapList(
    await db
      .from('user_sessions')
      .select('id, device, ip_address, user_agent, last_active_at, created_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('last_active_at', { ascending: false }),
  )
}

export async function revokeSession(db: Db, sessionId: string) {
  return unwrap(
    await db
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId)
      .select('id')
      .single(),
  )
}
