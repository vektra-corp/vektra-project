import { type Db, pageSize, unwrap, unwrapList } from '../helpers'

export async function listNotifications(
  db: Db,
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
) {
  let query = db
    .from('notifications')
    .select('id, type, title, body, data, is_read, created_at')
    .eq('user_id', userId)

  if (options.unreadOnly) query = query.eq('is_read', false)

  return unwrapList(
    await query.order('created_at', { ascending: false }).limit(pageSize(options.limit)),
  )
}

export async function countUnread(db: Db, userId: string): Promise<number> {
  const result = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)

  if (result.error) throw result.error
  return result.count ?? 0
}

export async function markRead(db: Db, notificationId: string) {
  return unwrap(
    await db
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .select('id')
      .single(),
  )
}

export async function markAllRead(db: Db, userId: string) {
  const result = await db
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false)

  if (result.error) throw result.error
}

export async function getPreferences(db: Db, userId: string, orgId: string) {
  const result = await db
    .from('notification_preferences')
    .select('preferences, quiet_hours, digest_mode')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (result.error) throw result.error
  return result.data
}
