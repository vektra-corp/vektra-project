'use client'

import { Button, Input, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createLabel, deleteLabel } from '../actions'

export interface ProjectLabel {
  id: string
  name: string
  color: string
  /** Null means the label is org-wide and shared with every other project. */
  projectId: string | null
}

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

/**
 * A starting palette, so creating a label is one field and not a colour-picker
 * exercise. These are the chip colours the board already uses.
 */
const PALETTE = [
  '#E5484D',
  '#F76B15',
  '#FFB224',
  '#46A758',
  '#12A594',
  '#0091FF',
  '#8E4EC6',
  '#E93D82',
] as const

/**
 * Project label management.
 *
 * Labels had no creation surface anywhere in the app — the task panel's picker
 * could only ever say "No labels defined for this project yet", which is a dead
 * end rather than a state. This is that surface.
 *
 * Org-wide labels are listed but not editable here: they belong to every
 * project, so deleting one from inside a single project would take it away from
 * the others.
 */
export function ProjectLabels({
  scope,
  labels,
  canEdit,
}: {
  scope: Scope
  labels: ProjectLabel[]
  canEdit: boolean
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PALETTE[0])
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function add() {
    const trimmed = name.trim()
    if (!trimmed) return

    startTransition(async () => {
      const result = await createLabel(scope, { name: trimmed, color })
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not create label', description: result.message })
        return
      }
      setName('')
      router.refresh()
    })
  }

  function remove(label: ProjectLabel) {
    if (
      !window.confirm(
        `Delete “${label.name}”? It will be removed from every task that carries it.`,
      )
    ) {
      return
    }

    startTransition(async () => {
      const result = await deleteLabel(scope, label.id)
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not delete label', description: result.message })
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="border-border bg-surface shadow-card rounded-lg border">
      <div className="border-border-subtle border-b px-5 py-4">
        <h2 className="text-ui font-semibold">Labels</h2>
        <p className="text-muted-foreground pt-1 text-base">
          Used to tag tasks, and to group the backlog into epics on the planning board.
        </p>
      </div>

      <div className="space-y-4 px-5 py-5">
        {labels.length === 0 ? (
          <p className="text-faint text-ui">No labels yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {labels.map((label) => (
              <li
                key={label.id}
                className="border-border bg-card flex items-center gap-2 rounded-md border px-2 py-1"
              >
                <span
                  aria-hidden
                  className="h-[9px] w-[9px] shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="text-ui">{label.name}</span>

                {label.projectId === null ? (
                  <span className="text-faint text-micro uppercase">org-wide</span>
                ) : canEdit ? (
                  <button
                    type="button"
                    onClick={() => remove(label)}
                    disabled={pending}
                    aria-label={`Delete label ${label.name}`}
                    className="text-faint hover:text-destructive px-0.5 text-[11px] transition-colors"
                  >
                    ✕
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
              <label htmlFor="new-label-name" className="text-nav text-subtle">
                New label
              </label>
              <Input
                id="new-label-name"
                value={name}
                maxLength={40}
                placeholder="e.g. Commissioning"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    add()
                  }
                }}
              />
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-nav text-subtle pb-1.5">Colour</legend>
              <div className="flex items-center gap-1.5">
                {PALETTE.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setColor(swatch)}
                    aria-label={`Use colour ${swatch}`}
                    aria-pressed={color === swatch}
                    className={
                      'h-6 w-6 rounded-full transition-transform ' +
                      (color === swatch ? 'ring-ring ring-2 ring-offset-2' : 'hover:scale-110')
                    }
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </fieldset>

            <Button size="sm" onClick={add} loading={pending} disabled={!name.trim()}>
              Add label
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
