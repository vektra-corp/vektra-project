'use client'

import { Button, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setProjectArchived } from '../../actions'

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

/**
 * Archive / restore.
 *
 * Separated from the settings form above rather than left to the status
 * dropdown inside it: picking "Archived" from a list of four statuses gives no
 * warning and reads like any other field change, when it is the one change that
 * takes the project out of everybody's sidebar.
 *
 * There is no delete button, and that is the design, not an omission — see the
 * note on `setProjectArchived`. Saying so here is cheaper than fielding the
 * question.
 */
export function ProjectArchive({
  scope,
  projectName,
  archived,
  canEdit,
}: {
  scope: Scope
  projectName: string
  archived: boolean
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function run(next: boolean) {
    if (
      next &&
      !window.confirm(
        `Archive “${projectName}”? It leaves the project list and the sidebar. ` +
          'Its tasks, comments and logged time are kept, and you can restore it here.',
      )
    ) {
      return
    }

    startTransition(async () => {
      const result = await setProjectArchived(
        scope.orgSlug,
        scope.workspaceSlug,
        scope.projectId,
        next,
      )
      if (!result.ok) {
        toast({
          variant: 'destructive',
          title: next ? 'Could not archive' : 'Could not restore',
          description: result.message,
        })
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="border-destructive/30 bg-surface shadow-card rounded-lg border">
      <div className="border-border-subtle border-b px-5 py-4">
        <h2 className="text-ui font-semibold">{archived ? 'Archived' : 'Danger zone'}</h2>
        <p className="text-muted-foreground pt-1 text-base">
          {archived
            ? 'This project is archived. Restoring puts it back in the project list.'
            : 'Archiving hides the project without destroying anything it holds.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
        <p className="text-faint max-w-md text-ui">
          Projects are never deleted outright — tasks, comments, attachments and logged time hang
          off them, and quotations can reference them.
        </p>

        <Button
          variant={archived ? 'secondary' : 'destructive'}
          size="sm"
          loading={pending}
          disabled={!canEdit}
          onClick={() => run(!archived)}
        >
          {archived ? 'Restore project' : 'Archive project'}
        </Button>
      </div>
    </section>
  )
}
