'use client'

import { Button, Checkbox, toast } from '@pm/ui'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { deleteTimeEntry, updateTimeEntry } from './actions'

export interface TimeEntryRow {
  id: string
  day: string
  description: string | null
  projectName: string
  taskTitle: string | null
  durationMinutes: number
  isBillable: boolean
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
}

/**
 * Entries for one week, grouped by day.
 *
 * Read-only once the week is submitted: the action refuses the write anyway,
 * but a control that looks live and then fails is worse than one that is
 * visibly disabled.
 */
export function EntryList({
  orgSlug,
  entries,
  locked,
}: {
  orgSlug: string
  entries: TimeEntryRow[]
  locked: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const byDay = new Map<string, TimeEntryRow[]>()
  for (const entry of entries) {
    const list = byDay.get(entry.day) ?? []
    list.push(entry)
    byDay.set(entry.day, list)
  }

  function toggleBillable(entry: TimeEntryRow, isBillable: boolean) {
    startTransition(async () => {
      const result = await updateTimeEntry(orgSlug, entry.id, { is_billable: isBillable })
      if (result.ok) router.refresh()
      else toast({ variant: 'destructive', title: 'Could not update', description: result.message })
    })
  }

  function remove(entryId: string) {
    startTransition(async () => {
      const result = await deleteTimeEntry(orgSlug, entryId)
      if (result.ok) {
        toast({ title: 'Entry deleted' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not delete', description: result.message })
      }
    })
  }

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-[13px] text-faint">
        No time logged this week.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {[...byDay.entries()].map(([day, dayEntries]) => {
        const dayTotal = dayEntries.reduce((sum, entry) => sum + entry.durationMinutes, 0)

        return (
          <section
            key={day}
            className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
          >
            <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
              <h3 className="label-meta text-faint">
                {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                })}
              </h3>
              <span className="label-meta ms-auto tabular-nums text-muted-foreground">
                {formatDuration(dayTotal)}
              </span>
            </header>

            <ul className="divide-y divide-border-subtle">
              {dayEntries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">
                      {entry.description || <span className="text-faint">No description</span>}
                    </p>
                    <p className="label-meta pt-1 text-faint">
                      {entry.projectName}
                      {entry.taskTitle ? ` · ${entry.taskTitle}` : ''}
                    </p>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      size="sm"
                      checked={entry.isBillable}
                      disabled={locked || pending}
                      onChange={(event) => toggleBillable(entry, event.target.checked)}
                    />
                    <span className="label-meta text-faint">Billable</span>
                  </label>

                  <span className="w-20 text-end font-mono text-[13px] tabular-nums">
                    {formatDuration(entry.durationMinutes)}
                  </span>

                  {locked ? null : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete entry"
                      disabled={pending}
                      onClick={() => remove(entry.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
