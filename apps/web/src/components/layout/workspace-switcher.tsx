'use client'

import { cn } from '@pm/ui'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { signOut } from '@/app/(auth)/actions'
import { BrandMark } from './brand-mark'

export interface SwitcherWorkspace {
  id: string
  name: string
  slug: string
  /** `DELIVERY · WORKSPACE` — the caption under the name in the menu. */
  sub: string
  /** `Business · Owner · 5 seats`. */
  meta: string
  color: string | null
  current: boolean
}

/**
 * The sidebar's identity row: which workspace you are in, and the way out of it.
 *
 * The design makes this the switcher rather than a link into settings — the
 * mark, the workspace name and a mono caption, opening a 262px menu that lists
 * every workspace with its plan and seat count, then new workspace, workspace
 * settings and sign out.
 *
 * Sign-out posts to a server action inside a form rather than calling it from
 * an onClick, so it still works if hydration has not finished.
 */
export function WorkspaceSwitcher({
  orgSlug,
  workspaces,
  current,
}: {
  orgSlug: string
  workspaces: SwitcherWorkspace[]
  /** Shown on the row itself: the active workspace, or the org when there is none. */
  current: { name: string; sub: string }
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Close on an outside click or Escape, the way every other menu in the app does.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Switch workspace"
        className={cn(
          'flex w-full items-center gap-[9px] rounded-lg px-1.5 py-1 text-start transition-colors',
          open ? 'bg-surface-hover' : 'hover:bg-surface-hover/60',
        )}
      >
        <BrandMark className="h-[22px] w-[22px]" />
        <span className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-base font-semibold tracking-[0.02em] leading-tight">
            {current.name}
          </span>
          <span className="label-meta text-faint truncate tracking-[0.08em]">{current.sub}</span>
        </span>
        <span
          aria-hidden
          className="border-input text-faint ms-auto grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border font-glyph text-[9px] leading-none"
        >
          ⌄
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="border-input bg-popover shadow-overlay absolute start-0 top-11 z-30 flex w-[262px] flex-col gap-0.5 rounded-[11px] border p-1.5"
        >
          <span className="text-subtle px-2 pb-[5px] pt-1.5 font-mono text-[8.5px] uppercase leading-none tracking-[0.14em]">
            Workspaces
          </span>

          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              role="menuitem"
              href={`/${orgSlug}/${workspace.slug}/projects`}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg p-2 transition-colors',
                workspace.current ? 'bg-surface-hover' : 'hover:bg-surface-hover',
              )}
            >
              <span
                aria-hidden
                className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] text-[10px] font-semibold text-[#04120F]"
                style={{ backgroundColor: workspace.color ?? 'hsl(var(--primary))' }}
              >
                {workspace.current ? '✓' : ''}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-ui font-medium">{workspace.name}</span>
                <span className="text-subtle truncate font-mono text-[8.5px] uppercase leading-none tracking-[0.06em]">
                  {workspace.meta}
                </span>
              </span>
            </Link>
          ))}

          <Link
            role="menuitem"
            href={`/${orgSlug}/settings/workspaces`}
            onClick={() => setOpen(false)}
            className="border-border-subtle text-primary hover:bg-surface-hover mt-[3px] flex items-center gap-2 rounded-lg border-t p-2 text-ui transition-colors"
          >
            <span aria-hidden className="font-glyph">＋</span> New workspace
          </Link>
          <Link
            role="menuitem"
            href={`/${orgSlug}/settings/general`}
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:bg-surface-hover flex items-center gap-2 rounded-lg p-2 text-ui transition-colors"
          >
            Workspace settings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="text-faint hover:bg-surface-hover hover:text-destructive flex w-full items-center gap-2 rounded-lg p-2 text-start text-ui transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
