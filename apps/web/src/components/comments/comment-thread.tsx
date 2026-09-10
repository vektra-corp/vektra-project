'use client'

import { formatRelativeTime, initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Badge, Button } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { createComment } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import { RichTextView } from '@/components/editor/rich-text'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import type { KanbanScope } from '@/components/kanban/types'

export interface CommentRow {
  id: string
  body: unknown
  is_internal: boolean
  is_edited: boolean
  created_at: string
  author: { id: string; full_name: string; avatar_url: string | null } | null
}

export function CommentThread({
  scope,
  taskId,
  comments,
  locale,
  canComment,
}: {
  scope: KanbanScope
  taskId: string
  comments: CommentRow[]
  locale: string
  canComment: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Remounting the editor is the simplest reliable way to clear it after a
  // successful post — Tiptap owns its own document state.
  const [composerKey, setComposerKey] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  function submit() {
    const form = formRef.current
    if (!form) return

    const formData = new FormData(form)
    if (!String(formData.get('body') ?? '').trim()) return

    startTransition(async () => {
      const result = await createComment(scope, taskId, null, formData)
      if (result.ok) {
        setError(null)
        setComposerKey((key) => key + 1)
        router.refresh()
      } else {
        setError(result.message)
      }
    })
  }

  return (
    <section className="space-y-4">
      <h2 className="text-ui font-medium">
        Comments <span className="tabular-nums text-muted-foreground">{comments.length}</span>
      </h2>

      <ul className="space-y-4">
        {comments.map((comment) => (
          <li key={comment.id} className="flex gap-3">
            <Avatar className="h-7 w-7 shrink-0">
              {comment.author?.avatar_url ? (
                <AvatarImage src={comment.author.avatar_url} alt="" />
              ) : null}
              <AvatarFallback className="text-[10px]">
                {initials(comment.author?.full_name ?? '?')}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ui font-medium">
                  {comment.author?.full_name ?? 'Unknown'}
                </span>
                <span className="text-nav text-muted-foreground">
                  {formatRelativeTime(comment.created_at, locale)}
                </span>
                {comment.is_edited ? (
                  <span className="text-nav text-muted-foreground">(edited)</span>
                ) : null}
                {comment.is_internal ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Internal
                  </Badge>
                ) : null}
              </div>
              <RichTextView doc={comment.body} className="mt-1" />
            </div>
          </li>
        ))}
        {comments.length === 0 ? (
          <li className="text-ui text-muted-foreground">No comments yet.</li>
        ) : null}
      </ul>

      {canComment ? (
        <form
          ref={formRef}
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <RichTextEditor
            key={composerKey}
            name="body"
            placeholder="Write a comment, or type @ to mention a teammate…"
            minHeight="min-h-[84px]"
            onSubmit={submit}
            mentions={{ orgSlug: scope.orgSlug, taskId }}
          />
          {error ? <p className="text-nav text-destructive">{error}</p> : null}
          {/*
            * There is no "internal only" toggle any more. It existed solely to
            * hide a comment from external portal users, and the portal is gone
            * — so the control could no longer change who sees anything. The
            * `is_internal` column and its badge stay for comments written
            * while the portal existed.
            */}
          <div className="flex items-center justify-end gap-3">
            <Button type="submit" size="sm" loading={pending}>
              Comment
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
