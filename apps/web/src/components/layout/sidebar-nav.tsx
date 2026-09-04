'use client'

import { cn } from '@pm/ui'
import {
  ChevronDown,
  CalendarRange,
  CircleDot,
  Columns3,
  Contact,
  FileSignature,
  FileText,
  Files,
  Gauge,
  Inbox,
  Layers,
  LayoutDashboard,
  ListTodo,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Split,
  Table2,
  Timer,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'

/**
 * Icons are addressed by NAME, not by component.
 *
 * The sidebar is a server component and these rows cross into a client one. A
 * Lucide icon is a function, and functions cannot be serialized across that
 * boundary — passing one throws "Functions cannot be passed directly to Client
 * Components" at request time, which no type check catches. A string crosses
 * fine and is resolved here.
 */
const ICONS = {
  CalendarRange,
  CircleDot,
  Columns3,
  Contact,
  FileSignature,
  FileText,
  Files,
  Gauge,
  Inbox,
  Layers,
  LayoutDashboard,
  ListTodo,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Split,
  Table2,
  Timer,
  TrendingUp,
  Users,
  Wallet,
} as const

export type IconName = keyof typeof ICONS

export interface NavItem {
  key: string
  label: string
  icon: IconName
  /** Absent for a destination that is not built yet — see `SidebarItem`. */
  href?: string
  count?: number | null
  /** Exact match only. Without it a parent stays lit on every child route. */
  exact?: boolean
}

function useIsActive() {
  const pathname = usePathname()
  return (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
}

const rowClass =
  'group flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors'

/**
 * One navigation row.
 *
 * An item with no `href` renders as inert rather than as a link: the design
 * shows the full product surface, but a nav entry that leads to a route this
 * phase has not built would be a 404, so it is shown and marked unavailable.
 */
export function SidebarItem({ item, indent = false }: { item: NavItem; indent?: boolean }) {
  const isActive = useIsActive()
  const active = item.href ? isActive(item.href, item.exact) : false
  const Icon = ICONS[item.icon]

  const body = (
    <>
      <Icon
        className={cn(
          'h-4 w-4 shrink-0 transition-colors',
          active ? 'text-foreground' : 'text-faint group-hover:text-muted-foreground',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-start">{item.label}</span>
      {item.count ? (
        <span className="text-faint font-mono text-[10px] font-medium tabular-nums">
          {item.count}
        </span>
      ) : null}
      {!item.href ? (
        <span className="label-meta-sm bg-surface-hover text-faint rounded px-1 py-0.5">soon</span>
      ) : null}
    </>
  )

  if (!item.href) {
    return (
      <li>
        <span
          aria-disabled
          title={`${item.label} arrives in a later phase`}
          className={cn(rowClass, indent && 'ps-8', 'text-faint/70 cursor-default')}
        >
          {body}
        </span>
      </li>
    )
  }

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          rowClass,
          indent && 'ps-8',
          active
            ? 'bg-surface-hover text-foreground font-medium'
            : 'text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground',
        )}
      >
        {body}
      </Link>
    </li>
  )
}

/** A collapsible titled group, e.g. "WORK · DELIVERY" or "COMMERCIAL". */
export function SidebarSection({
  title,
  collapsible = false,
  children,
}: {
  title: string
  collapsible?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="pt-4">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="label-meta text-faint hover:text-muted-foreground flex w-full items-center gap-1.5 px-2.5 pb-1.5 transition-colors"
        >
          <span className="flex-1 text-start">{title}</span>
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', !open && 'rtl-flip -rotate-90')}
            aria-hidden
          />
        </button>
      ) : (
        <h2 className="label-meta text-faint px-2.5 pb-1.5">{title}</h2>
      )}
      {open ? <ul className="space-y-px">{children}</ul> : null}
    </div>
  )
}

export interface SidebarProject {
  id: string
  name: string
  workspaceSlug: string
  color: string | null
}

/**
 * A project row that expands into its views while you are inside it.
 *
 * Expansion follows the route rather than local state, so arriving at a board
 * by any means — a link, a refresh, the back button — shows the same open
 * project, and only one project is ever expanded.
 */
export function SidebarProjectGroup({
  orgSlug,
  project,
  views,
}: {
  orgSlug: string
  project: SidebarProject
  views: NavItem[]
}) {
  const isActive = useIsActive()
  const base = `/${orgSlug}/${project.workspaceSlug}/projects/${project.id}`
  const inProject = isActive(base)

  return (
    <>
      <li>
        <Link
          href={`${base}/board`}
          className={cn(
            rowClass,
            inProject
              ? 'text-foreground font-medium'
              : 'text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground',
          )}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: project.color ?? 'hsl(var(--status-progress))' }}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-start">{project.name}</span>
          <ChevronDown
            className={cn(
              'text-faint h-3 w-3 transition-transform',
              !inProject && 'rtl-flip -rotate-90',
            )}
            aria-hidden
          />
        </Link>
      </li>

      {inProject ? (
        <li>
          {/* The rule aligns with the project dot above, tying the views to it. */}
          <ul className="before:bg-border-subtle relative space-y-px before:absolute before:inset-y-1 before:start-[15px] before:w-px">
            {views.map((view) => (
              <SidebarItem key={view.key} item={view} indent />
            ))}
          </ul>
        </li>
      ) : null}
    </>
  )
}
