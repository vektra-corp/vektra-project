'use client'

import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@pm/ui'
import { Check, ChevronDown, Trash2 } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { deleteKanbanView } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/view-actions'
import type { KanbanScope } from '@/components/kanban/types'

export interface SavedView {
  id: string
  name: string
  isShared: boolean
  isMine: boolean
}

/**
 * Saved board view switcher.
 *
 * The active view is a search param, so a board someone shares as a link opens
 * on the same view they were looking at (§10).
 */
export function SavedViewMenu({
  scope,
  views,
  activeId,
  activeName,
  activeIsShared,
}: {
  scope: KanbanScope
  views: SavedView[]
  activeId: string
  activeName: string
  activeIsShared: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function switchTo(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (id === 'default') params.delete('view')
    else params.set('view', id)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteKanbanView(scope, id)
      if (result.ok) {
        if (id === activeId) switchTo('default')
        toast({ title: 'View deleted' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not delete', description: result.message })
      }
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="inline-flex h-7 select-none items-center gap-2 rounded-md border border-border-subtle bg-surface px-2.5 text-base text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {activeName}
        {activeIsShared ? (
          <Badge variant="secondary" shape="meta">
            Shared
          </Badge>
        ) : null}
        <ChevronDown className="h-3 w-3 text-faint" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Board views</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => switchTo('default')}>
          {activeId === 'default' ? (
            <Check className="text-primary" aria-hidden />
          ) : (
            <span className="h-4 w-4" aria-hidden />
          )}
          Default view
        </DropdownMenuItem>

        {views.map((view) => (
          <DropdownMenuItem
            key={view.id}
            // Deleting from inside the row must not also switch to it.
            onSelect={(event) => {
              if ((event.target as HTMLElement).closest('[data-delete]')) {
                event.preventDefault()
                return
              }
              switchTo(view.id)
            }}
          >
            {activeId === view.id ? (
              <Check className="text-primary" aria-hidden />
            ) : (
              <span className="h-4 w-4" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">{view.name}</span>
            {view.isShared ? (
              <Badge variant="secondary" shape="meta">
                S
              </Badge>
            ) : null}
            {view.isMine ? (
              <button
                type="button"
                data-delete
                aria-label={`Delete ${view.name}`}
                onClick={() => remove(view.id)}
                className="rounded p-0.5 text-faint transition-colors hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
          </DropdownMenuItem>
        ))}

        {views.length === 0 ? (
          <p className="px-2 py-3 text-center text-nav text-faint">
            Customize the board to save a view.
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
