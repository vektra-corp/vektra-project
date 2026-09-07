'use client'

import { KANBAN_SORT_BY, type KanbanViewConfig } from '@pm/shared/constants'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { saveKanbanView } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/view-actions'
import type { KanbanScope } from '@/components/kanban/types'

const SORT_LABELS: Record<string, string> = {
  position: 'Manual order',
  priority: 'Priority',
  due_date: 'Due date',
  created_at: 'Created',
  title: 'Title',
}

/**
 * "Save current as view", from the foot of the board settings panel.
 *
 * The panel's own controls already apply live; this is the separate act of
 * naming the arrangement so it can be returned to and, optionally, shared. It
 * carries the sort order too, which is the one facet the panel has no room for
 * and which the design keeps in the saved view rather than on the toolbar.
 */
export function SaveViewDialog({
  scope,
  boardId,
  view,
  canShare,
}: {
  scope: KanbanScope
  boardId: string
  view: KanbanViewConfig
  canShare: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // A brand-new view is named for what it does, so the default is not "My view".
  const isNew = view.id === 'default'

  function submit(formData: FormData) {
    // The panel is the source of truth for these; the form only adds a name,
    // a sort and the shared flag, so the rest rides along unchanged.
    formData.set('group_by', view.group_by)
    formData.set('card_color_by', view.card_color_by)
    for (const field of view.card_fields) formData.append('card_fields', field)
    if (view.compact_mode) formData.set('compact_mode', 'on')
    if (view.show_empty_columns) formData.set('show_empty_columns', 'on')

    startTransition(async () => {
      const result = await saveKanbanView(scope, boardId, isNew ? null : view.id, formData)
      if (result.ok) {
        setOpen(false)
        toast({ title: isNew ? 'View saved' : 'View updated' })
        router.replace(`?view=${result.data.id}`, { scroll: false })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not save', description: result.message })
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border text-primary hover:bg-surface-hover mt-auto rounded-[7px] border-t px-2 py-2.5 text-start text-ui transition-colors"
      >
        <span aria-hidden className="font-glyph">
          ＋
        </span>{' '}
        {isNew ? 'Save current as view' : `Update “${view.name}”`}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isNew ? 'Save a board view' : `Edit “${view.name}”`}</DialogTitle>
            <DialogDescription>
              Grouping, card fields and sorting are saved per view. Nothing here changes the tasks
              themselves.
            </DialogDescription>
          </DialogHeader>

          <form action={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="view-name">View name</Label>
              <Input
                id="view-name"
                name="name"
                defaultValue={isNew ? 'My view' : view.name}
                required
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sort-by">Sort cards by</Label>
              <div className="flex gap-2">
                <select
                  id="sort-by"
                  name="sort_by"
                  defaultValue={view.sort_by}
                  className="border-input bg-card focus-visible:ring-ring/60 flex h-9 min-w-0 flex-1 rounded-md border px-3 text-ui focus-visible:outline-none focus-visible:ring-2"
                >
                  {KANBAN_SORT_BY.map((option) => (
                    <option key={option} value={option}>
                      {SORT_LABELS[option] ?? option}
                    </option>
                  ))}
                </select>
                <select
                  name="sort_order"
                  defaultValue={view.sort_order}
                  aria-label="Sort direction"
                  className="border-input bg-card focus-visible:ring-ring/60 flex h-9 rounded-md border px-2 text-ui focus-visible:outline-none focus-visible:ring-2"
                >
                  <option value="asc">Asc</option>
                  <option value="desc">Desc</option>
                </select>
              </div>
            </div>

            {canShare ? (
              <label className="flex cursor-pointer items-center gap-2.5 text-base">
                <Checkbox name="is_shared" size="sm" defaultChecked={view.is_shared} />
                Share with everyone on this project
              </label>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                {isNew ? 'Save view' : 'Update view'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
