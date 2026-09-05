'use client'

import { slugify } from '@pm/shared/utils'
import {
  Alert,
  AlertDescription,
  Button,
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
import { AlertCircle, FolderPlus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createWorkspace, deleteWorkspace } from '../actions'

export interface WorkspaceRow {
  id: string
  name: string
  slug: string
  description: string | null
  color: string | null
  project_count: number
  member_count: number
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      Create workspace
    </Button>
  )
}

export function WorkspaceManager({
  orgSlug,
  workspaces,
  canManage,
}: {
  orgSlug: string
  workspaces: WorkspaceRow[]
  canManage: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const router = useRouter()

  const [state, formAction] = useFormState(createWorkspace.bind(null, orgSlug), null)

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      setName('')
      setSlug('')
      setSlugTouched(false)
      toast({ title: 'Workspace created' })
      router.refresh()
    }
  }, [state, router])

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-base text-muted-foreground">
          Workspaces group projects and scope who can see them.
        </p>
        {canManage ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            <FolderPlus className="h-3.5 w-3.5" aria-hidden />
            New workspace
          </Button>
        ) : null}
      </div>

      <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface">
        {workspaces.length === 0 ? (
          <li className="px-5 py-10 text-center text-ui text-muted-foreground">
            No workspaces yet.
          </li>
        ) : (
          workspaces.map((workspace) => (
            <li key={workspace.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: workspace.color ?? 'hsl(var(--status-progress))' }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/${orgSlug}/${workspace.slug}/projects`}
                  className="text-base font-medium transition-colors hover:text-primary"
                >
                  {workspace.name}
                </Link>
                <p className="label-meta pt-1 text-faint">
                  /{workspace.slug}
                  <span className="px-1.5 opacity-50">·</span>
                  {workspace.project_count} projects
                  <span className="px-1.5 opacity-50">·</span>
                  {workspace.member_count} members
                </p>
              </div>
              {canManage ? (
                <DeleteWorkspaceButton
                  orgSlug={orgSlug}
                  workspace={workspace}
                  onDone={() => router.refresh()}
                />
              ) : null}
            </li>
          ))
        )}
      </ul>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              Projects live inside a workspace. You can add people to it afterwards.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            {state && !state.ok && !state.fieldErrors ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input
                id="ws-name"
                name="name"
                value={name}
                autoFocus
                required
                maxLength={100}
                onChange={(event) => {
                  setName(event.target.value)
                  // Mirror the name into the slug until the slug is edited by
                  // hand, then leave it alone.
                  if (!slugTouched) setSlug(slugify(event.target.value))
                }}
              />
              {fieldError('name') ? (
                <p className="text-nav text-destructive">{fieldError('name')}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ws-slug">URL slug</Label>
              <Input
                id="ws-slug"
                name="slug"
                value={slug}
                required
                maxLength={48}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(event.target.value)
                }}
              />
              <p className="text-nav text-faint">
                /{orgSlug}/{slug || 'workspace'}/projects
              </p>
              {fieldError('slug') ? (
                <p className="text-nav text-destructive">{fieldError('slug')}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ws-description">Description</Label>
              <Input id="ws-description" name="description" maxLength={1000} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Deleting a workspace cascades to its projects, so the action refuses while it
 * still holds any. The dialog states that up front rather than surfacing it as a
 * failure after the fact.
 */
function DeleteWorkspaceButton({
  orgSlug,
  workspace,
  onDone,
}: {
  orgSlug: string
  workspace: WorkspaceRow
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function confirm() {
    startTransition(async () => {
      const result = await deleteWorkspace(orgSlug, workspace.id)
      if (result.ok) {
        setOpen(false)
        toast({ title: `Deleted ${workspace.name}` })
        onDone()
      } else {
        setError(result.message)
      }
    })
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${workspace.name}`}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {workspace.name}?</DialogTitle>
            <DialogDescription>
              {workspace.project_count > 0
                ? `This workspace still holds ${workspace.project_count} project${workspace.project_count === 1 ? '' : 's'}. Move or delete them first.`
                : 'This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={pending}
              disabled={workspace.project_count > 0}
              onClick={confirm}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
