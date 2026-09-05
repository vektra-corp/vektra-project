import { formatRelativeTime } from '@pm/shared/utils'
import { Badge, Button } from '@pm/ui'
import { Bell } from 'lucide-react'
import Link from 'next/link'
import { getLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Notification bell.
 *
 * Server-rendered on each navigation. RLS restricts `notifications` to
 * `user_id = auth.uid()`, so this cannot show another person's items even if
 * the query were wrong.
 */
export async function NotificationBell({ orgSlug }: { orgSlug: string }) {
  const locale = await getLocale()
  const supabase = createClient()

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, type, title, body, data, is_read, created_at')
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(8)

  const unread = notifications?.length ?? 0

  return (
    <details className="relative">
      <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent [&::-webkit-details-marker]:hidden">
        <span className="relative">
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </span>
        <span className="sr-only">
          {unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        </span>
      </summary>

      <div className="absolute end-0 z-50 mt-2 w-80 rounded-md border bg-popover p-2 shadow-lg">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-ui font-medium">Notifications</span>
          {unread > 0 ? <Badge variant="secondary">{unread}</Badge> : null}
        </div>

        {unread === 0 ? (
          <p className="px-2 py-6 text-center text-ui text-muted-foreground">
            You are all caught up.
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {(notifications ?? []).map((notification) => {
              // Notifications about a task deep-link to it; the rest are just text.
              const data = notification.data as
                | { project_id?: string; task_id?: string; workspace_slug?: string }
                | null
              const body = (
                <div className="rounded-md px-2 py-2 hover:bg-accent">
                  <p className="text-ui font-medium leading-snug">{notification.title}</p>
                  <p className="text-nav text-muted-foreground">
                    {notification.body} · {formatRelativeTime(notification.created_at, locale)}
                  </p>
                </div>
              )

              return (
                <li key={notification.id}>
                  {data?.task_id ? (
                    <Link href={`/${orgSlug}/notifications#${notification.id}`}>{body}</Link>
                  ) : (
                    body
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="border-t pt-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href={`/${orgSlug}/notifications`}>View all</Link>
          </Button>
        </div>
      </div>
    </details>
  )
}
