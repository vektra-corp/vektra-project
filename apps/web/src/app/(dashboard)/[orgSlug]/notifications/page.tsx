import { formatRelativeTime } from '@pm/shared/utils'
import { Button, cn } from '@pm/ui'
import {
  AtSign,
  Bell,
  CircleCheck,
  MessageSquare,
  Receipt,
  Split,
  type LucideIcon,
} from 'lucide-react'
import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { getLocale } from 'next-intl/server'
import { PageBody, SectionHeader } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Inbox' }

/**
 * How each notification type presents: a tracked-caps category on the right and
 * a glyph in the row's leading circle.
 *
 * The design puts a person's avatar there, but a notification row carries no
 * actor — `notifications.data` records the subject (task, workflow), never who
 * acted. Rather than invent initials, the circle shows what KIND of thing
 * happened, which is the part the data actually knows.
 */
const KINDS: Record<string, { label: string; icon: LucideIcon }> = {
  comment_mention: { label: 'MENTION', icon: AtSign },
  comment: { label: 'COMMENT', icon: MessageSquare },
  task_assigned: { label: 'ASSIGNED', icon: CircleCheck },
  task_status: { label: 'STATUS', icon: CircleCheck },
  due_soon: { label: 'DUE', icon: Bell },
  workflow: { label: 'WORKFLOW', icon: Split },
  billing: { label: 'BILLING', icon: Receipt },
}

const FALLBACK = { label: 'UPDATE', icon: Bell } as const

/**
 * Compact age: "40M", "2H", "3D". The design sets these in the meta face beside
 * the category, where a full "about 2 hours ago" would not fit and would fight
 * the column of categories for attention. The exact timestamp stays on the
 * row's `title` for anyone who needs it.
 */
function compactAge(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}M`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}H`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}D`
  return `${Math.round(days / 7)}W`
}

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

  const rows = notifications ?? []
  const unread = rows.filter((n) => !n.is_read).length
  const now = Date.now()

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Inbox' }]} />
      <SectionHeader title="Inbox" count={unread > 0 ? `${unread} unread` : 'all read'}>
        {unread > 0 ? (
          <form action={markAllRead}>
            <Button type="submit" variant="subtle" size="sm">
              Mark all read
            </Button>
          </form>
        ) : null}
      </SectionHeader>

      <PageBody className="p-0">

        <ul>
          {rows.map((notification) => {
            const kind = KINDS[notification.type] ?? FALLBACK
            const Icon = kind.icon
            const unreadRow = !notification.is_read
            return (
              <li
                key={notification.id}
                title={formatRelativeTime(notification.created_at, locale)}
                className="border-border hover:bg-surface-hover/40 flex items-center gap-3 border-b px-5 py-3.5 transition-colors"
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    unreadRow ? 'bg-primary' : 'bg-transparent',
                  )}
                />
                <span
                  aria-hidden
                  className="bg-chip text-faint grid h-7 w-7 shrink-0 place-items-center rounded-full"
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'truncate text-base',
                      unreadRow ? 'text-foreground font-semibold' : 'text-muted-foreground',
                    )}
                  >
                    {notification.title}
                  </p>
                  {notification.body ? (
                    <p className="text-faint truncate pt-0.5 text-ui">{notification.body}</p>
                  ) : null}
                </div>

                <span className="label-meta-lg text-subtle shrink-0">{kind.label}</span>
                <span className="label-id text-faint w-8 shrink-0 text-end">
                  {compactAge(notification.created_at, now)}
                </span>
              </li>
            )
          })}
          {rows.length === 0 ? (
            <li className="text-faint px-5 py-16 text-center text-base">Nothing here yet.</li>
          ) : null}
        </ul>
      </PageBody>
    </>
  )
}
