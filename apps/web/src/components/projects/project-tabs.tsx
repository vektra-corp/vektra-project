'use client'

import { cn } from '@pm/ui'
import { Columns3, List } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * View switcher. Timeline and Documents arrive in V1, so only the two shipped
 * views are listed — a tab that leads to a 404 is worse than no tab.
 */
const VIEWS = [
  { segment: 'board', label: 'Board', icon: Columns3 },
  { segment: 'list', label: 'List', icon: List },
] as const

export function ProjectTabs({ base }: { base: string }) {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 border-b" aria-label="Project views">
      {VIEWS.map((view) => {
        const href = `${base}/${view.segment}`
        const active = pathname === href || pathname.startsWith(`${href}/`)

        return (
          <Link
            key={view.segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <view.icon className="h-4 w-4" aria-hidden />
            {view.label}
          </Link>
        )
      })}
    </nav>
  )
}
