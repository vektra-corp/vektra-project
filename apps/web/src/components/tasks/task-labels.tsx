'use client'

import { cn, toast } from '@pm/ui'
import { useEffect, useRef, useState, useTransition } from 'react'
import { setTaskLabels } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import type { KanbanScope } from '@/components/kanban/types'

export interface LabelOption {
  id: string
  name: string
  color: string
}

/**
 * The task's labels, as the design's rail shows them: a wrapped row of chips
 * under a fixed-width caption.
 *
 * Editing opens a small picker rather than a dialog — a label is one of the
 * cheapest edits on a task, and sending it through a modal makes it the most
 * expensive. The whole set is written at once (`setTaskLabels` replaces the
 * junction rows), so there is no partial state to reconcile.
 */
export function TaskLabels({
  scope,
  taskId,
  selected,
  options,
  canEdit,
}: {
  scope: KanbanScope
  taskId: string
  selected: LabelOption[]
  options: LabelOption[]
  canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  const [ids, setIds] = useState(() => selected.map((label) => label.id))
  const [pending, startTransition] = useTransition()
  const root = useRef<HTMLDivElement>(null)

  // Re-seed when the server sends a new set (another editor, a refresh).
  const [seed, setSeed] = useState(selected)
  if (seed !== selected) {
    setSeed(selected)
    setIds(selected.map((label) => label.id))
  }

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

  function toggle(labelId: string) {
    const next = ids.includes(labelId)
      ? ids.filter((entry) => entry !== labelId)
      : [...ids, labelId]
    setIds(next)
    startTransition(async () => {
      const result = await setTaskLabels(scope, taskId, next)
      if (!result.ok) {
        // Put the chip back rather than leaving the rail showing a label the
        // database refused.
        setIds(ids)
        toast({ variant: 'destructive', title: 'Could not update labels', description: result.message })
      }
    })
  }

  const chosen = options.filter((label) => ids.includes(label.id))

  return (
    <div ref={root} className="relative flex items-start gap-2.5">
      <span className="text-faint w-[74px] shrink-0 pt-1 text-nav">Labels</span>

      <div className="flex min-w-0 flex-1 flex-wrap gap-[5px]">
        {chosen.map((label) => (
          <span
            key={label.id}
            className="bg-chip rounded-[5px] px-[7px] py-0.5 text-[11px]"
            style={{ color: label.color }}
          >
            {label.name}
          </span>
        ))}

        {chosen.length === 0 && !canEdit ? (
          <span className="text-subtle text-micro">None</span>
        ) : null}

        {canEdit ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            disabled={pending}
            className={cn(
              'border-input text-subtle hover:text-foreground rounded-[5px] border border-dashed px-[7px] py-0.5 text-[11px] transition-colors',
              pending && 'opacity-60',
            )}
          >
            {chosen.length === 0 ? '＋ Add label' : '＋'}
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          role="listbox"
          aria-label="Labels"
          className="border-input bg-popover shadow-raised absolute end-0 top-7 z-20 flex max-h-56 w-[188px] flex-col gap-px overflow-y-auto rounded-lg border p-1"
        >
          {options.length === 0 ? (
            <p className="text-subtle px-2 py-2 text-micro">
              No labels defined for this project yet.
            </p>
          ) : (
            options.map((label) => (
              <button
                key={label.id}
                type="button"
                role="option"
                aria-selected={ids.includes(label.id)}
                onClick={() => toggle(label.id)}
                className="hover:bg-surface-hover flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-start text-micro transition-colors"
              >
                <span
                  aria-hidden
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="min-w-0 flex-1 truncate">{label.name}</span>
                {ids.includes(label.id) ? (
                  <span aria-hidden className="text-primary text-[10px]">
                    ✓
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
