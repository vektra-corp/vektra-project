'use client'

import { formatRelativeTime, initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Badge, Button } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { createComment } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import type { KanbanScope } from '@/components/kanban/types'

export interface CommentRow {
  id: string
  body: unknown
  is_internal: boolean
  is_edited: boolean
  created_at: string
  author: { id: string; full_name: string; avatar_url: string | null } | null
}

/**
 * Render a Tiptap document as plain paragraphs.
 *
 * Bodies are sanitized before storage (§13.1) and rendered through React here,
 * which escapes text — so no `dangerouslySetInnerHTML` is needed or wanted.
 */
function renderBody(body: unknown): string[] {
  const doc = body as { content?: { content?: { text?: string }[] }[] } | null
  if (!doc?.content) return []
  return doc.content.map((block) =>
    (block.content ?? []).map((node) => node.text ?? '').join(''),
  )
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const internalRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function submit() {
    const text = textareaRef.current?.value.trim()
    if (!text) return

    const formData = new FormData()
    formData.set('body', text)
    if (internalRef.current?.checked) formData.set('is_internal', 'on')

    startTransition(async () => {
      const result = await createComment(scope, taskId, null, formData)
      if (result.ok) {
        setError(null)
        if (textareaRef.current) textareaRef.current.value = ''
        router.refresh()
      } else {
        setError(result.message)
      }
    })
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium">
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
                <span className="text-sm font-medium">
                  {comment.author?.full_name ?? 'Unknown'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(comment.created_at, locale)}
                </span>
                {comment.is_edited ? (
                  <span className="text-xs text-muted-foreground">(edited)</span>
                ) : null}
                {comment.is_internal ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Internal
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1 space-y-2 text-sm">
                {renderBody(comment.body).map((paragraph, index) => (
                  // eslint-disable-next-line react/no-array-index-key -- paragraphs have no stable id
                  <p key={index} className="whitespace-pre-wrap break-words">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </li>
        ))}
        {comments.length === 0 ? (
          <li className="text-sm text-muted-foreground">No comments yet.</li>
        ) : null}
      </ul>

      {canComment ? (
        <div className="space-y-2 rounded-md border p-3">
          <textarea
            ref={textareaRef}
            rows={3}
            placeholder="Write a comment..."
            aria-label="Comment"
            disabled={pending}
            className="w-full resize-y bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter submits; plain Enter is a newline in a comment.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                submit()
              }
            }}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input ref={internalRef} type="checkbox" className="h-3.5 w-3.5 rounded border-input" />
              Internal only (hidden from portal users)
            </label>
            <Button size="sm" loading={pending} onClick={submit}>
              Comment
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
