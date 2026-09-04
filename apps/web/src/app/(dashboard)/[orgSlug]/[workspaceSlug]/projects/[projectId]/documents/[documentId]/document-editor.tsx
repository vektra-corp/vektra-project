'use client'

import { DOCUMENT_STATUSES } from '@pm/shared/constants'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  toast,
} from '@pm/ui'
import { ChevronDown, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { RichTextView } from '@/components/editor/rich-text'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import type { KanbanScope } from '@/components/kanban/types'
import { deleteDocument, updateDocument } from '../actions'

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'outline'> = {
  draft: 'secondary',
  published: 'success',
  archived: 'outline',
}

export interface DocumentRecord {
  id: string
  title: string
  content: unknown
  status: string
  version: number
}

/**
 * Document editor.
 *
 * Read-only until you choose to edit, because a document is read far more often
 * than it is changed. Title and status save on their own without touching the
 * body, so renaming or publishing does not create a new content version — the
 * snapshot trigger only fires when the body actually differs.
 */
export function DocumentEditor({
  scope,
  document,
  canEdit,
  canDelete,
}: {
  scope: KanbanScope
  document: DocumentRecord
  canEdit: boolean
  canDelete: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  const hasContent = Boolean((document.content as { content?: unknown[] } | null)?.content?.length)

  function saveBody() {
    const form = formRef.current
    if (!form) return

    const formData = new FormData(form)
    if (!String(formData.get('content') ?? '').trim()) {
      formData.set('content', JSON.stringify({ type: 'doc', content: [] }))
    }

    startTransition(async () => {
      const result = await updateDocument(scope, document.id, null, formData)
      if (result.ok) {
        setError(null)
        setEditing(false)
        router.refresh()
      } else {
        setError(result.message)
      }
    })
  }

  /** Title and status only — `content` is deliberately absent from the payload. */
  function saveMeta(patch: { title?: string; status?: string }) {
    const formData = new FormData()
    formData.set('title', patch.title ?? document.title)
    formData.set('status', patch.status ?? document.status)

    startTransition(async () => {
      const result = await updateDocument(scope, document.id, null, formData)
      if (result.ok) {
        toast({ title: patch.status ? `Moved to ${patch.status}` : 'Renamed' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not save', description: result.message })
      }
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteDocument(scope, document.id)
      if (result.ok) {
        toast({ title: 'Document deleted' })
        router.push(
          `/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/documents`,
        )
      } else {
        toast({ variant: 'destructive', title: 'Could not delete', description: result.message })
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <Input
            name="title"
            form="document-form"
            defaultValue={document.title}
            required
            maxLength={200}
            className="h-9 max-w-md text-base font-semibold"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
            {document.title}
          </h1>
        )}

        <Badge variant={STATUS_VARIANT[document.status] ?? 'secondary'} shape="meta">
          {document.status}
        </Badge>
        <span className="label-meta text-faint">v{document.version}</span>

        {canEdit && !editing ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="subtle" size="sm" className="gap-1.5" disabled={pending}>
                  Status
                  <ChevronDown className="h-3 w-3 text-faint" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={document.status}
                  onValueChange={(status) => saveMeta({ status })}
                >
                  {DOCUMENT_STATUSES.map((status) => (
                    <DropdownMenuRadioItem key={status} value={status} className="capitalize">
                      {status}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="subtle" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3" aria-hidden />
              Edit
            </Button>

            {canDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2 aria-hidden />
                    Delete document
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        ) : null}
      </div>

      {editing ? (
        <form
          id="document-form"
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault()
            saveBody()
          }}
          className="space-y-3"
        >
          <RichTextEditor
            name="content"
            defaultValue={hasContent ? document.content : undefined}
            placeholder="Write the document…"
            minHeight="min-h-[320px]"
            onSubmit={saveBody}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
            <p className="label-meta ms-auto text-faint">Saving creates version {document.version + 1}</p>
          </div>
        </form>
      ) : hasContent ? (
        <RichTextView doc={document.content} className="rounded-lg border border-border bg-surface p-5 shadow-card" />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-faint">
          {canEdit ? 'This document is empty — add some content.' : 'This document is empty.'}
        </p>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{document.title}”?</DialogTitle>
            <DialogDescription>
              This removes the document and all {document.version} of its versions. It cannot be
              undone — archiving keeps the history instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={pending} onClick={remove}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
