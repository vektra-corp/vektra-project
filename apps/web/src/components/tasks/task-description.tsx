'use client'

import { Button } from '@pm/ui'
import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { updateTask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import { RichTextView } from '@/components/editor/rich-text'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import type { KanbanScope } from '@/components/kanban/types'

/**
 * Task description.
 *
 * Read-only until you choose to edit, because a description is read far more
 * often than it is changed and an always-live editor invites accidental edits.
 */
export function TaskDescription({
  scope,
  taskId,
  description,
  canEdit,
}: {
  scope: KanbanScope
  taskId: string
  description: unknown
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  const hasContent = Boolean((description as { content?: unknown[] } | null)?.content?.length)

  function save() {
    const form = formRef.current
    if (!form) return

    const formData = new FormData(form)
    // updateTask only patches keys that are present, so an empty description
    // must post an empty document rather than nothing at all.
    if (!String(formData.get('description') ?? '').trim()) {
      formData.set('description', JSON.stringify({ type: 'doc', content: [] }))
    }

    startTransition(async () => {
      const result = await updateTask(scope, taskId, null, formData)
      if (result.ok) {
        setError(null)
        setEditing(false)
        router.refresh()
      } else {
        setError(result.message)
      }
    })
  }

  if (!editing) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-ui font-medium">Description</h2>
          {canEdit ? (
            <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3" aria-hidden />
              Edit
            </Button>
          ) : null}
        </div>

        {hasContent ? (
          <RichTextView doc={description} />
        ) : (
          <p className="text-ui text-faint">
            {canEdit ? 'No description yet — add one.' : 'No description.'}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="space-y-2">
      <h2 className="text-ui font-medium">Description</h2>
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        className="space-y-2"
      >
        <RichTextEditor
          name="description"
          defaultValue={hasContent ? description : undefined}
          placeholder="Add context, acceptance criteria, links…"
          onSubmit={save}
        />
        {error ? <p className="text-nav text-destructive">{error}</p> : null}
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" loading={pending}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  )
}
