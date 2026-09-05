import { Kbd, Separator } from '@pm/ui'
import type { AdminContext } from '@/lib/auth'
import { AdminNav, type AdminNavItem } from './admin-nav'
import { AdminBrandMark } from './brand-mark'
import { AdminSignOut } from './sign-out'

/**
 * Console shell.
 *
 * Visually a sibling of the customer app — same tokens, same rhythm — but it
 * flies the corporate V where the product flies its P, so an operator can never
 * mistake a service-role console for the tenant app they were just looking at.
 */
export function AdminShell({
  admin,
  children,
}: {
  admin: AdminContext
  children: React.ReactNode
}) {
  const items: AdminNavItem[] = [
    { href: '/orgs', label: 'Organizations', group: 'Tenants' },
    { href: '/users', label: 'Users', group: 'Tenants' },
    { href: '/subscriptions', label: 'Subscriptions', group: 'Revenue' },
    { href: '/notices', label: 'System notices', group: 'Messaging' },
    { href: '/feature-flags', label: 'Feature flags', group: 'Messaging' },
    { href: '/audit-logs', label: 'Audit logs', group: 'Support' },
    { href: '/system-health', label: 'System health', group: 'Support' },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-e border-border-subtle bg-surface md:flex">
        <div className="flex items-center gap-2.5 px-3 py-3">
          <AdminBrandMark />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight">Platform console</p>
            <p className="label-meta-sm truncate pt-1 text-faint">Service role · all tenants</p>
          </div>
        </div>

        <AdminNav items={items} />

        <div className="mt-auto px-2 pb-2">
          <Separator className="mb-2" />
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight">{admin.fullName}</p>
              <p className="label-meta-sm truncate pt-1 text-faint">{admin.role}</p>
            </div>
            <AdminSignOut />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  )
}

/** Section header for a console page. */
export function AdminHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="pt-1 text-[13px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function AdminBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 pb-8">{children}</div>
  )
}

export { Kbd }
