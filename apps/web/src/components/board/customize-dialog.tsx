'use client'

import {
  KANBAN_SWIMLANE_BY,
  type KanbanCardField,
  type KanbanColorBy,
  type KanbanSwimlaneBy,
  type KanbanViewConfig,
} from '@pm/shared/constants'
import { cn, toast } from '@pm/ui'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { updateKanbanColumn } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import { updateKanbanView } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/view-actions'
import type { KanbanScope } from '@/components/kanban/types'
import { SaveViewDialog } from './save-view-dialog'

/**
 * The three card presets the design offers, and what each one means in terms of
 * the fields a card actually shows (§19.8 `card_fields`).
 *
 * The panel presents a mode rather than eight checkboxes because that is what
 * the design presents; the underlying field list is still the stored truth, so
 * a view saved from the fuller form elsewhere keeps working.
 */
const CARD_MODES = {
  minimal: {
    label: 'Minimal',
    note: 'Title and assignee only.',
    compact: true,
    fields: ['assignee'] as KanbanCardField[],
  },
  standard: {
    label: 'Standard',
    note: 'Key, priority, assignee, points.',
    compact: false,
    fields: ['task_number', 'priority', 'assignee', 'estimated_hours'] as KanbanCardField[],
  },
  full: {
    label: 'Full',
    note: 'Adds labels, subtask progress, logged time and due date.',
    compact: false,
    fields: [
      'task_number',
      'priority',
      'assignee',
      'estimated_hours',
      'labels',
      'subtask_progress',
      'time_logged',
      'due_date',
    ] as KanbanCardField[],
  },
} as const

type CardMode = keyof typeof CARD_MODES

/** Which preset the stored field list most closely is. */
function modeOf(view: KanbanViewConfig): CardMode {
  if (view.compact_mode) return 'minimal'
  return view.card_fields.includes('time_logged') || view.card_fields.includes('labels')
    ? 'full'
    : 'standard'
}

const COLOR_MODES: { value: KanbanColorBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'priority', label: 'Priority' },
  { value: 'label', label: 'Label' },
]

const SWIM_LABELS: Record<KanbanSwimlaneBy, string> = {
  none: 'No swimlanes',
  priority: 'Lanes by priority',
  assignee: 'Lanes by assignee',
  label: 'Lanes by label',
  custom_field: 'Lanes by custom field',
}

/** A segmented button inside the panel: equal width, 7px radius, 12px. */
function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-[7px] border py-1.5 text-center text-nav transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-input text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/** A filter chip in the panel's FILTER · sections. */
function FilterPill({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean
  onClick: () => void
  color?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-micro transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-input text-muted-foreground hover:text-foreground',
      )}
    >
      {color ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      {children}
    </button>
  )
}

const PRIORITY_FILTERS = [
  { value: 'critical', label: 'Urgent', color: 'hsl(var(--priority-critical))' },
  { value: 'high', label: 'High', color: 'hsl(var(--priority-high))' },
  { value: 'medium', label: 'Med', color: 'hsl(var(--priority-medium))' },
  { value: 'low', label: 'Low', color: 'hsl(var(--priority-low))' },
]

/**
 * Board settings (§19.8).
 *
 * The design opens this as a 274px panel down the right of the board, not as a
 * modal — you are meant to see the board rearrange as you press things, which a
 * dialog covering it would defeat. Every control therefore applies immediately;
 * "Save as view" is the separate, deliberate act of naming the arrangement.
 *
 * Saving always writes a view rather than mutating the board, so one person's
 * grouping never changes what a teammate sees — unless they deliberately share
 * it. Column names and WIP limits are the exception, and are marked as such:
 * they belong to the project's workflow, so they change it for everyone.
 */
export function CustomizeDialog({
  scope,
  boardId,
  view,
  canShare,
  columns,
  assignees,
  labels,
}: {
  scope: KanbanScope
  boardId: string
  view: KanbanViewConfig
  canShare: boolean
  columns: { id: string; name: string; status: string; wip_limit?: number | null }[]
  assignees: { id: string; full_name: string }[]
  labels: { id: string; name: string; color: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const mode = modeOf(view)

  function patchView(patch: Parameters<typeof updateKanbanView>[3]) {
    startTransition(async () => {
      const result = await updateKanbanView(scope, boardId, view.id, patch)
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not apply', description: result.message })
        return
      }
      // A first patch materialises the default view, so follow it by id.
      if (view.id === 'default') router.replace(`?view=${result.data.id}`, { scroll: false })
      router.refresh()
    })
  }

  function toggleFilter(param: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    const current = params.getAll(param)
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]
    params.delete(param)
    for (const entry of next) params.append(param, entry)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const selectedAssignees = searchParams.getAll('assignee')
  const selectedPriorities = searchParams.getAll('priority')
  const selectedLabels = searchParams.getAll('label')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-input text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-nav transition-colors"
      >
        <span aria-hidden className="font-glyph">
          ⚙
        </span>
        Customize
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-expanded
        className="border-primary text-primary flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-nav transition-colors"
      >
        <span aria-hidden className="font-glyph">
          ⚙
        </span>
        Customize
      </button>

      {/*
        * Fixed rather than in flow: the toolbar this button lives in is above
        * the board, and the panel has to sit beside the board itself. It is
        * pinned under the two header rows and runs to the floor.
        */}
      <aside
        aria-label="Board settings"
        data-pending={pending ? '' : undefined}
        className="border-border bg-surface scrollbar-slim fixed bottom-0 end-0 top-[105px] z-20 flex w-[274px] flex-col gap-[18px] overflow-y-auto border-s p-4 data-[pending]:opacity-70"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-task font-semibold">Board settings</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close board settings"
            className="text-subtle hover:text-foreground ms-auto text-nav transition-colors"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="label-meta-lg text-subtle">Card fields</h3>
          <div className="flex gap-[5px]">
            {(Object.keys(CARD_MODES) as CardMode[]).map((key) => (
              <ModeButton
                key={key}
                active={mode === key}
                onClick={() =>
                  patchView({
                    compact_mode: CARD_MODES[key].compact,
                    card_fields: [...CARD_MODES[key].fields],
                  })
                }
              >
                {CARD_MODES[key].label}
              </ModeButton>
            ))}
          </div>
          <p className="text-faint text-micro leading-normal">{CARD_MODES[mode].note}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="label-meta-lg text-subtle">Color code by</h3>
          <div className="flex gap-[5px]">
            {COLOR_MODES.map((option) => (
              <ModeButton
                key={option.value}
                active={view.card_color_by === option.value}
                onClick={() => patchView({ card_color_by: option.value })}
              >
                {option.label}
              </ModeButton>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="label-meta-lg text-subtle">Swimlanes</h3>
          <div className="flex flex-col gap-[3px]">
            {KANBAN_SWIMLANE_BY.filter((option) => option !== 'custom_field').map((option) => {
              const active = view.swimlane_by === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => patchView({ swimlane_by: option })}
                  className={cn(
                    'flex items-center gap-2 rounded-[7px] px-2.5 py-[7px] text-start text-ui transition-colors',
                    active ? 'bg-surface-hover' : 'hover:bg-surface-hover/60',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid h-3 w-3 shrink-0 place-items-center rounded-full border-[1.5px]',
                      active ? 'border-primary' : 'border-input',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        active ? 'bg-primary' : 'bg-transparent',
                      )}
                    />
                  </span>
                  {SWIM_LABELS[option]}
                </button>
              )
            })}
          </div>
        </section>

        {view.group_by === 'status' && columns.length > 0 ? (
          <section className="flex flex-col gap-[9px]">
            <h3 className="label-meta-lg text-subtle">Columns</h3>
            {columns.map((column) => (
              <ColumnConfigCard key={column.id} scope={scope} column={column} />
            ))}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="label-meta-lg text-subtle">Filter · assignee</h3>
          <div className="flex flex-wrap gap-[5px]">
            {assignees.length === 0 ? (
              <p className="text-subtle text-micro">Nobody is assigned yet.</p>
            ) : (
              assignees.map((person) => (
                <FilterPill
                  key={person.id}
                  active={selectedAssignees.includes(person.id)}
                  onClick={() => toggleFilter('assignee', person.id)}
                >
                  {person.full_name.split(' ')[0]}
                </FilterPill>
              ))
            )}
          </div>

          <h3 className="label-meta-lg text-subtle pt-1">Filter · priority</h3>
          <div className="flex flex-wrap gap-[5px]">
            {PRIORITY_FILTERS.map((priority) => (
              <FilterPill
                key={priority.value}
                active={selectedPriorities.includes(priority.value)}
                onClick={() => toggleFilter('priority', priority.value)}
                color={priority.color}
              >
                {priority.label}
              </FilterPill>
            ))}
          </div>

          {labels.length > 0 ? (
            <>
              <h3 className="label-meta-lg text-subtle pt-1">Filter · label</h3>
              <div className="flex flex-wrap gap-[5px]">
                {labels.map((label) => (
                  <FilterPill
                    key={label.id}
                    active={selectedLabels.includes(label.id)}
                    onClick={() => toggleFilter('label', label.id)}
                    color={label.color}
                  >
                    {label.name}
                  </FilterPill>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <SaveViewDialog scope={scope} boardId={boardId} view={view} canShare={canShare} />
      </aside>
    </>
  )
}

/**
 * One column's card in the panel: its name, and its WIP limit on a stepper.
 *
 * The name commits on blur rather than on every keystroke — it is a shared
 * setting, and a write per character would be a write per character for
 * everyone watching the board.
 */
function ColumnConfigCard({
  scope,
  column,
}: {
  scope: KanbanScope
  column: { id: string; name: string; wip_limit?: number | null }
}) {
  const [name, setName] = useState(column.name)
  const [limit, setLimit] = useState(column.wip_limit ?? 0)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function commit(patch: { name?: string; wip_limit?: number | null }) {
    startTransition(async () => {
      const result = await updateKanbanColumn(scope, column.id, patch)
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not update', description: result.message })
        return
      }
      router.refresh()
    })
  }

  function step(delta: number) {
    const next = Math.max(0, limit + delta)
    setLimit(next)
    commit({ wip_limit: next })
  }

  return (
    <div
      className={cn(
        'border-border bg-card flex flex-col gap-[7px] rounded-[9px] border px-[11px] py-2.5',
        pending && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="bg-muted-foreground h-[5px] w-[5px] shrink-0 rounded-full"
        />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() && name !== column.name && commit({ name })}
          aria-label={`Rename ${column.name}`}
          className="text-foreground min-w-0 flex-1 bg-transparent text-ui outline-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-faint text-micro">WIP limit</span>
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label={`Lower the limit on ${column.name}`}
          className="border-input text-muted-foreground hover:text-foreground grid h-[19px] w-[19px] place-items-center rounded-[6px] border text-micro transition-colors"
        >
          <span aria-hidden>−</span>
        </button>
        <span className="min-w-4 text-center font-mono text-micro tabular-nums">
          {limit > 0 ? limit : '—'}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label={`Raise the limit on ${column.name}`}
          className="border-input text-muted-foreground hover:text-foreground grid h-[19px] w-[19px] place-items-center rounded-[6px] border text-micro transition-colors"
        >
          <span aria-hidden>+</span>
        </button>
        <span className="text-subtle ms-auto font-mono text-meta uppercase">
          {limit > 0 ? 'OK' : 'No limit'}
        </span>
      </div>
    </div>
  )
}
