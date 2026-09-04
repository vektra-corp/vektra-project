'use client'

import { Button, toast } from '@pm/ui'
import { History, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { RichTextView } from '@/components/editor/rich-text'
import type { KanbanScope } from '@/components/kanban/types'
import { restoreDocumentVersion } from '../actions'

export interface VersionRow {
  id: string
  version: number
  content: unknown
  createdAt: string
  editorName: string
}

/**
 * Version history.
 *
 * Restoring does not rewind — it writes the old body as a new version, so the
 * state you replaced is itself preserved. The panel says so, because "restore"
 * usually implies losing what came after.
 */
export function VersionHistory({
  scope,
  documentId,
  versions,
  currentVersion,
  canRestore,
}: {
  scope: KanbanScope
  documentId: string
  versions: VersionRow[]
  currentVersion: number
  canRestore: boolean
}) {
  const [previewing, setPreviewing] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function restore(version: number) {
    startTransition(async () => {
      const result = await restoreDocumentVersion(scope, documentId, version)
      if (result.ok) {
        setPreviewing(null)
        toast({ title: `Restored v${version}`, description: `Saved as v${currentVersion + 1}` })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not restore', description: result.message })
      }
    })
  }

  return (
    <aside className="space-y-2">
      <h2 className="label-meta flex items-center gap-1.5 text-faint">
        <History className="h-3 w-3" aria-hidden />
        History
      </h2>

      <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <li className="flex items-center gap-2 px-3 py-2.5">
          <span className="label-meta text-foreground">v{currentVersion}</span>
          <span className="flex-1 text-[13px] text-muted-foreground">Current</span>
        </li>

        {versions.map((version) => (
          <li key={version.id} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="label-meta text-faint">v{version.version}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {version.editorName}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Preview version ${version.version}`}
                onClick={() =>
                  setPreviewing(previewing === version.version ? null : version.version)
                }
              >
                <History className="h-3 w-3" aria-hidden />
              </Button>
              {canRestore ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Restore version ${version.version}`}
                  loading={pending}
                  onClick={() => restore(version.version)}
                >
                  <RotateCcw className="h-3 w-3" aria-hidden />
                </Button>
              ) : null}
            </div>
            <p className="label-meta pt-1 text-faint">{version.createdAt}</p>

            {previewing === version.version ? (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border-subtle bg-surface-raised p-3">
                <RichTextView doc={version.content} />
              </div>
            ) : null}
          </li>
        ))}

        {versions.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-faint">
            No earlier versions yet.
          </li>
        ) : null}
      </ul>

      {canRestore && versions.length > 0 ? (
        <p className="px-1 text-xs leading-relaxed text-faint">
          Restoring writes the old body as a new version. Nothing is lost.
        </p>
      ) : null}
    </aside>
  )
}
