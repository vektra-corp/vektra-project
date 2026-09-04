import { formatDate } from '@pm/shared/utils'
import { Badge } from '@pm/ui'
import type { Metadata } from 'next'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { NoticeForm, NoticeToggle } from './notice-controls'

export const metadata: Metadata = { title: 'System notices' }

const TYPE_VARIANT: Record<string, 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warning: 'warning',
  critical: 'destructive',
  maintenance: 'outline',
}

/** Platform-wide messages shown inside the customer app. */
export default async function NoticesPage() {
  const admin = await requireAdmin()
  const readOnly = !canWrite(admin.role)
  const supabase = createAdminClient()

  const { data: notices } = await supabase
    .from('system_notices')
    .select('id, title, body, type, is_active, starts_at, ends_at, created_by, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <>
      <AdminHeader
        title="System notices"
        description="Shown to every tenant until they expire or are deactivated."
      />

      <AdminBody>
        <div className="max-w-3xl space-y-4">
          {readOnly ? null : <NoticeForm />}

          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {!notices?.length ? (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                No notices published.
              </li>
            ) : (
              notices.map((notice) => (
                <li key={notice.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={TYPE_VARIANT[notice.type] ?? 'secondary'} shape="meta">
                        {notice.type}
                      </Badge>
                      <span className="text-[13px] font-medium">{notice.title}</span>
                      {!notice.is_active ? (
                        <Badge variant="outline" shape="meta">
                          Inactive
                        </Badge>
                      ) : null}
                    </div>
                    <p className="pt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                      {notice.body}
                    </p>
                    <p className="label-meta pt-2 text-faint">
                      {notice.created_by}
                      <span className="px-1.5 opacity-50">·</span>
                      {formatDate(notice.created_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })}
                      {notice.ends_at ? (
                        <>
                          <span className="px-1.5 opacity-50">·</span>
                          ends{' '}
                          {formatDate(notice.ends_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <NoticeToggle id={notice.id} isActive={notice.is_active} disabled={readOnly} />
                </li>
              ))
            )}
          </ul>
        </div>
      </AdminBody>
    </>
  )
}
