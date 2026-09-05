'use client'

import { formatFileSize } from '@pm/shared/utils'
import { Button, cn } from '@pm/ui'
import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import {
  createUploadUrl,
  deleteAttachment,
  getAttachmentUrl,
  recordAttachment,
} from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/attachment-actions'
import type { KanbanScope } from '@/components/kanban/types'

export interface AttachmentRow {
  id: string
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
  uploaded_by: string
}

/**
 * Attachment panel.
 *
 * Bytes go from the browser straight to Supabase Storage, but only using a
 * signed token the server issued for one specific path — the client never picks
 * where a file lands (§13.9). Downloads use short-lived signed URLs, fetched on
 * demand rather than rendered into the page, so the markup holds no live links.
 */
export function AttachmentList({
  scope,
  taskId,
  attachments,
  locale,
  canEdit,
  currentUserId,
}: {
  scope: KanbanScope
  taskId: string
  attachments: AttachmentRow[]
  locale: string
  canEdit: boolean
  currentUserId: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function upload(file: File) {
    setError(null)
    setUploading(true)

    try {
      const authorized = await createUploadUrl(scope, taskId, {
        name: file.name,
        size: file.size,
        type: file.type,
      })

      if (!authorized.ok) {
        setError(authorized.message)
        return
      }

      const { path, token, fileId, fileName } = authorized.data

      // Uploaded with the server-issued token, to the server-chosen path.
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from('attachments')
        .uploadToSignedUrl(path, token, file)

      if (uploadError) {
        setError(uploadError.message)
        return
      }

      const recorded = await recordAttachment(scope, taskId, {
        fileId,
        fileName,
        size: file.size,
        mimeType: file.type,
      })

      if (!recorded.ok) {
        setError(recorded.message)
        return
      }

      router.refresh()
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function download(id: string) {
    setBusyId(id)
    try {
      const result = await getAttachmentUrl(scope, id)
      if (!result.ok) {
        setError(result.message)
        return
      }
      window.open(result.data.url, '_blank', 'noopener,noreferrer')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ui font-medium">
          Attachments{' '}
          <span className="tabular-nums text-muted-foreground">{attachments.length}</span>
        </h2>
        {canEdit ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              aria-label="Attach a file"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
              }}
            />
            <Button
              size="sm"
              variant="outline"
              loading={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-4 w-4" aria-hidden />
              Attach
            </Button>
          </>
        ) : null}
      </div>

      {error ? <p className="text-nav text-destructive">{error}</p> : null}

      {attachments.length === 0 ? (
        <p className="flex items-center gap-2 text-ui text-muted-foreground">
          <Paperclip className="h-4 w-4" aria-hidden />
          No files attached.
        </p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 rounded-md border px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui">{attachment.file_name}</p>
                <p className="text-nav text-muted-foreground">
                  {formatFileSize(attachment.file_size, locale)}
                </p>
              </div>

              <Button
                size="icon"
                variant="ghost"
                aria-label={`Download ${attachment.file_name}`}
                disabled={busyId === attachment.id}
                onClick={() => void download(attachment.id)}
              >
                {busyId === attachment.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-4 w-4" aria-hidden />
                )}
              </Button>

              {/* RLS permits the uploader or a manager; the button follows suit. */}
              {attachment.uploaded_by === currentUserId ? (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${attachment.file_name}`}
                  className={cn('text-muted-foreground hover:text-destructive')}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteAttachment(scope, attachment.id)
                      if (!result.ok) setError(result.message)
                      else router.refresh()
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
