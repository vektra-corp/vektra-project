'use client'

import { cn } from '@pm/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface AdminNavItem {
  href: string
  label: string
  group: string
}

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname()
  const groups = [...new Set(items.map((item) => item.group))]

  return (
    <nav className="scrollbar-slim flex-1 overflow-y-auto px-2 pb-4" aria-label="Console">
      {groups.map((group) => (
        <div key={group} className="pt-4">
          <h2 className="label-meta px-2.5 pb-1.5 text-faint">{group}</h2>
          <ul className="space-y-px">
            {items
              .filter((item) => item.group === group)
              .map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 items-center rounded-md px-2.5 text-[13px] transition-colors',
                        active
                          ? 'bg-surface-hover font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
