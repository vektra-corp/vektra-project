'use client'

import {
  Alert,
  AlertDescription,
  Badge,
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
import { AlertCircle, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { invitePortalUser, setPortalProjectAccess, setPortalUserStatus } from './actions'

export interface PortalUserRow {
  id: string
  email: string
  fullName: string
  status: string
  projectIds: string[]
}

export interface ProjectOption {
  id: string
  name: string
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      Send invite
    </Button>
  )
}

/**
 * External access management.
 *
 * The project checkboxes are the allowlist itself (§18 rule 6) — ticking one is
 * the only thing that makes a project visible to that person. Nothing here is
 * implicit, which is why the list is a plain set of toggles rather than a role.
 */
export function PortalManager({
  orgSlug,
  portalUsers,
  projects,
  seatLimit,
}: {
  orgSlug: string
  portalUsers: PortalUserRow[]
  projects: ProjectOption[]
  seatLimit: number | null
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useFormState(invitePortalUser.bind(null, orgSlug), null)
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      toast({ title: 'Portal invite sent', description: state.data.email })
      router.refresh()
    }
  }, [state, router])

  const atLimit = seatLimit !== null && portalUsers.length >= seatLimit
  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          External people see only the projects ticked below, and never internal comments.
        </p>
        <Button size="sm" onClick={() => setOpen(true)} disabled={atLimit}>
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          Invite guest
        </Button>
      </div>

      {seatLimit !== null ? (
        <Alert variant={atLimit ? 'warning' : 'default'}>
          <AlertCircle aria-hidden />
          <AlertDescription>
            {seatLimit === 0
              ? 'Your plan does not include portal users. Upgrade to invite external collaborators.'
              : `Using ${portalUsers.length} of ${seatLimit} portal seats on your plan.`}
          </AlertDescription>
        </Alert>
      ) : null}

      <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {portalUsers.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            No external users yet.
          </li>
        ) : (
          portalUsers.map((user) => (
            <PortalUserRowItem
              key={user.id}
              orgSlug={orgSlug}
              user={user}
              projects={projects}
              onDone={() => router.refresh()}
            />
          ))
        )}
      </ul>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite an external collaborator</DialogTitle>
            <DialogDescription>
              They get a portal login with no access to your organization. Share projects with them
              afterwards.
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
              <Label htmlFor="portal-name">Full name</Label>
              <Input id="portal-name" name="full_name" required autoFocus maxLength={120} />
              {fieldError('full_name') ? (
                <p className="text-xs text-destructive">{fieldError('full_name')}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="portal-email">Email</Label>
              <Input id="portal-email" name="email" type="email" required />
              {fieldError('email') ? (
                <p className="text-xs text-destructive">{fieldError('email')}</p>
              ) : null}
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

function PortalUserRowItem({
  orgSlug,
  user,
  projects,
  onDone,
}: {
  orgSlug: string
  user: PortalUserRow
  projects: ProjectOption[]
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()

  function toggleProject(projectId: string, grant: boolean) {
    startTransition(async () => {
      const result = await setPortalProjectAccess(orgSlug, user.id, projectId, grant)
      if (result.ok) onDone()
      else toast({ variant: 'destructive', title: 'Failed', description: result.message })
    })
  }

  function toggleStatus() {
    const next = user.status === 'active' ? 'disabled' : 'active'
    startTransition(async () => {
      const result = await setPortalUserStatus(orgSlug, user.id, next)
      if (result.ok) {
        toast({ title: next === 'active' ? 'Access restored' : 'Access revoked' })
        onDone()
      } else {
        toast({ variant: 'destructive', title: 'Failed', description: result.message })
      }
    })
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{user.fullName}</p>
          <p className="label-meta pt-1 text-faint">{user.email}</p>
        </div>
        <Badge variant={user.status === 'active' ? 'success' : 'outline'} shape="meta">
          {user.status}
        </Badge>
        <Button variant="ghost" size="xs" loading={pending} onClick={toggleStatus}>
          {user.status === 'active' ? 'Revoke' : 'Restore'}
        </Button>
      </div>

      {projects.length > 0 ? (
        <fieldset className="pt-3" disabled={pending || user.status !== 'active'}>
          <legend className="label-meta pb-1.5 text-faint">Shared projects</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {projects.map((project) => (
              <label
                key={project.id}
                className="flex cursor-pointer items-center gap-2.5 text-[13px]"
              >
                <Checkbox
                  size="sm"
                  checked={user.projectIds.includes(project.id)}
                  onChange={(event) => toggleProject(project.id, event.target.checked)}
                />
                <span className="truncate">{project.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="pt-2 text-xs text-faint">Create a project before sharing one.</p>
      )}
    </li>
  )
}
