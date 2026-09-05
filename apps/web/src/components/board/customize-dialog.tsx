'use client'

import {
  KANBAN_CARD_FIELDS,
  KANBAN_CARD_FIELD_LABELS,
  KANBAN_GROUP_BY,
  KANBAN_GROUP_BY_LABELS,
  KANBAN_SORT_BY,
  type KanbanViewConfig,
} from '@pm/shared/constants'
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
import { SlidersHorizontal } from 'lucide-react'
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
 * Board customization (§19.8).
 *
 * Saving always writes a view rather than mutating the board, so one person's
 * grouping never changes what a teammate sees — unless they deliberately share it.
 */
export function CustomizeDialog({
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
      <Button variant="subtle" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        Customize
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="group-by">Group columns by</Label>
                <select
                  id="group-by"
                  name="group_by"
                  defaultValue={view.group_by}
                  className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {KANBAN_GROUP_BY.filter(
                    // These two need the custom-fields module; offering them now
                    // would silently fall back to status grouping.
                    (option) => option !== 'custom_field' && option !== 'due_date_range',
                  ).map((option) => (
                    <option key={option} value={option}>
                      {KANBAN_GROUP_BY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sort-by">Sort cards by</Label>
                <div className="flex gap-2">
                  <select
                    id="sort-by"
                    name="sort_by"
                    defaultValue={view.sort_by}
                    className="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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
                    className="flex h-9 rounded-md border border-input bg-card px-2 text-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <option value="asc">Asc</option>
                    <option value="desc">Desc</option>
                  </select>
                </div>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="pb-1 text-ui font-medium">Show on cards</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {KANBAN_CARD_FIELDS.map((field) => (
                  <label
                    key={field}
                    className="flex cursor-pointer items-center gap-2.5 text-base"
                  >
                    <Checkbox
                      name="card_fields"
                      value={field}
                      size="sm"
                      defaultChecked={view.card_fields.includes(field)}
                    />
                    {KANBAN_CARD_FIELD_LABELS[field]}
                  </label>
                ))}
              </div>
            </fieldset>

            <input type="hidden" name="card_color_by" value={view.card_color_by} />

            <fieldset className="space-y-1.5">
              <legend className="pb-1 text-ui font-medium">Display</legend>
              <label className="flex cursor-pointer items-center gap-2.5 text-base">
                <Checkbox
                  name="show_empty_columns"
                  size="sm"
                  defaultChecked={view.show_empty_columns}
                />
                Show empty columns
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 text-base">
                <Checkbox name="compact_mode" size="sm" defaultChecked={view.compact_mode} />
                Compact cards
              </label>
              {canShare ? (
                <label className="flex cursor-pointer items-center gap-2.5 text-base">
                  <Checkbox name="is_shared" size="sm" defaultChecked={view.is_shared} />
                  Share with everyone on this project
                </label>
              ) : null}
            </fieldset>

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
