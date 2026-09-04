import { formatRelativeTime } from '@pm/shared/utils'
import { Button, Card, CardContent, cn } from '@pm/ui'
import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { getLocale } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationsPage({ params }: { params: { orgSlug: string } }) {
  await requireAuthPage(params.orgSlug)
  const locale = await getLocale()
  const supabase = createClient()

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, type, title, body, data, is_read, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  async function markAllRead() {
    'use server'
    const db = createClient()
    // RLS scopes this to the caller's own rows, so no user_id filter is needed.
    await db
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('is_read', false)
    revalidatePath(`/${params.orgSlug}/notifications`)
  }

  const unread = (notifications ?? []).filter((n) => !n.is_read).length

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Inbox' }]} />
      <PageBody>
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Notifications</h1>
              <p className="text-muted-foreground text-sm">
                {unread > 0 ? `${unread} unread` : 'Nothing unread'}
              </p>
            </div>
            {unread > 0 ? (
              <form action={markAllRead}>
                <Button type="submit" variant="outline" size="sm">
                  Mark all read
                </Button>
              </form>
            ) : null}
          </div>

          <Card>
            <CardContent className="p-0">
              <ul>
                {(notifications ?? []).map((notification) => (
                  <li
                    key={notification.id}
                    className={cn(
                      'flex items-start gap-3 border-b px-4 py-3 last:border-0',
                      !notification.is_read && 'bg-primary/5',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        notification.is_read ? 'bg-transparent' : 'bg-primary',
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{notification.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {notification.body} · {formatRelativeTime(notification.created_at, locale)}
                      </p>
                    </div>
                  </li>
                ))}
                {!notifications?.length ? (
                  <li className="text-muted-foreground px-4 py-12 text-center text-sm">
                    No notifications yet.
                  </li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
