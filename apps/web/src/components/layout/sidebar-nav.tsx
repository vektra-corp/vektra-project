'use client'

import { cn } from '@pm/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { usePendingNav } from '@/hooks/use-pending-nav'
import { NavGlyphIcon, type NavGlyph } from './nav-glyph'

export type IconName = NavGlyph

export interface NavItem {
  key: string
  label: string
  icon: NavGlyph
  /** Absent for a destination that is not built yet — see `SidebarItem`. */
  href?: string
  count?: number | null
  /** Amber count, for a total that wants attention (overdue, unapproved). */
  countTone?: 'neutral' | 'attention' | 'accent'
  /** Exact match only. Without it a parent stays lit on every child route. */
  exact?: boolean
}

function useIsActive() {
  const pathname = usePathname()
  return (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The design's nav row: 6px/10px padding, a 7px radius, a 10px gutter between
 * the glyph and its label, and second-tier ink that goes full strength when the
 * row is the one you are on.
 */
const rowClass =
  'group flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-base transition-colors'

const countClass = {
  neutral: 'text-subtle',
  attention: 'text-warning',
  accent: 'text-primary',
} as const

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
  const { pending, onNavigate } = usePendingNav()

  const body = (
    <>
      <NavGlyphIcon
        glyph={item.icon}
        size={indent ? 'sm' : 'md'}
        className={cn(
          'transition-colors',
          active ? 'text-foreground' : 'text-faint group-hover:text-muted-foreground',
          pending && 'animate-pulse',
        )}
      />
      <span className="min-w-0 flex-1 truncate text-start">{item.label}</span>
      {item.count ? (
        <span className={cn('font-mono text-col tabular-nums', countClass[item.countTone ?? 'neutral'])}>
          {item.count}
        </span>
      ) : null}
      {!item.href ? (
        <span className="label-meta bg-chip text-subtle rounded-sm px-1 py-0.5">soon</span>
      ) : null}
    </>
  )

  if (!item.href) {
    return (
      <li>
        <span
          aria-disabled
          title={`${item.label} arrives in a later phase`}
          className={cn(rowClass, indent && 'py-[5px] ps-[25px] text-nav', 'text-subtle cursor-default')}
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
        onClick={onNavigate(item.href)}
        aria-current={active ? 'page' : undefined}
        // A row being navigated to is treated as active for styling: the click
        // should land visibly straight away rather than after the server replies.
        data-pending={pending ? '' : undefined}
        className={cn(
          rowClass,
          // A nested project view sits at 25px so its glyph lines up under the
          // project dot's label, and drops a step in ink.
          indent && 'gap-[9px] rounded-md py-[5px] pe-2 ps-[25px] text-nav',
          active || pending
            ? 'bg-surface-hover text-foreground'
            : indent
              ? 'text-faint hover:bg-surface-hover/60 hover:text-muted-foreground'
              : 'text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground',
        )}
      >
        {body}
      </Link>
    </li>
  )
}

/**
 * A titled group.
 *
 * The design gives section headings 9px mono at 0.14em on the fourth ink tier,
 * with 10px of side padding and 5px beneath — the same rhythm whether or not
 * the group can be folded.
 */
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
    <div className="flex flex-col gap-0.5">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="label-meta text-subtle hover:text-faint flex w-full items-center px-2.5 pb-[5px] transition-colors"
        >
          <span className="flex-1 text-start">{title}</span>
          <span aria-hidden className="font-glyph text-[9px] leading-none">
            {open ? '⌄' : '›'}
          </span>
        </button>
      ) : (
        <h2 className="label-meta text-subtle flex items-center px-2.5 pb-[5px]">{title}</h2>
      )}
      {open ? <ul className="flex flex-col gap-0.5">{children}</ul> : null}
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
 * project, and only one project is ever expanded. A collapsed project shows the
 * design's `›`, an open one its `⌄`.
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
  const { pending, onNavigate } = usePendingNav()
  const base = `/${orgSlug}/${project.workspaceSlug}/projects/${project.id}`
  const inProject = isActive(base)
  // Clicking the project itself lands on its overview, the design's home for a
  // project; the views under it are the other ways in.
  const home = `${base}/overview`

  return (
    <>
      <li>
        <Link
          href={home}
          onClick={onNavigate(home)}
          className={cn(
            'group flex w-full items-center gap-[9px] rounded-[7px] py-1.5 pe-2 ps-[11px] text-ui transition-colors',
            inProject || pending
              ? 'bg-surface-hover text-foreground'
              : 'text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn('h-[7px] w-[7px] shrink-0 rounded-full', pending && 'animate-pulse')}
            style={{ backgroundColor: project.color ?? 'hsl(var(--status-progress))' }}
          />
          <span className="min-w-0 flex-1 truncate text-start">{project.name}</span>
          <span
            aria-hidden
            className="font-glyph text-subtle grid h-4 w-4 shrink-0 place-items-center rounded-[5px] text-[9px] leading-none"
          >
            {inProject ? '⌄' : '›'}
          </span>
        </Link>
      </li>

      {inProject ? (
        <li>
          <ul className="flex flex-col gap-px pb-1 pt-px">
            {views.map((view) => (
              <SidebarItem key={view.key} item={view} indent />
            ))}
          </ul>
        </li>
      ) : null}
    </>
  )
}
