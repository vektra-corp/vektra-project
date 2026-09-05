'use client'

import { formatRelativeTime, initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Button } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { RichTextView } from '@/components/editor/rich-text'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { createPortalComment } from './actions'

export interface PortalCommentRow {
  id: string
  body: unknown
  createdAt: string
  authorName: string
  authorAvatar: string | null
}

/** Comment thread as an external user sees it — internal notes never reach here. */
export function PortalComments({
  orgSlug,
  projectId,
  taskId,
  comments,
  locale,
  canComment,
}: {
  orgSlug: string
  projectId: string
  taskId: string
  comments: PortalCommentRow[]
  locale: string
  canComment: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [composerKey, setComposerKey] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  function submit() {
    const form = formRef.current
    if (!form) return

    const formData = new FormData(form)
    if (!String(formData.get('body') ?? '').trim()) return

    startTransition(async () => {
      const result = await createPortalComment(orgSlug, projectId, taskId, null, formData)
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
    <div className="space-y-3">
      <ul className="space-y-3">
        {comments.map((comment) => (
          <li key={comment.id} className="flex gap-2.5">
            <Avatar className="h-6 w-6 shrink-0">
              {comment.authorAvatar ? <AvatarImage src={comment.authorAvatar} alt="" /> : null}
              <AvatarFallback className="bg-surface-hover text-[9px] font-medium uppercase text-muted-foreground">
                {initials(comment.authorName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2">
                <span className="text-base font-medium">{comment.authorName}</span>
                <span className="label-meta text-faint">
                  {formatRelativeTime(comment.createdAt, locale)}
                </span>
              </p>
              <RichTextView doc={comment.body} className="pt-1" />
            </div>
          </li>
        ))}
        {comments.length === 0 ? (
          <li className="text-base text-faint">No comments yet.</li>
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
            placeholder="Reply…"
            minHeight="min-h-[72px]"
            onSubmit={submit}
          />
          {error ? <p className="text-nav text-destructive">{error}</p> : null}
          <Button type="submit" size="sm" loading={pending}>
            Comment
          </Button>
        </form>
      ) : null}
    </div>
  )
}
