'use client'

import { ASSIGNABLE_ORG_ROLES, ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS } from '@pm/auth/constants'
import type { OrgRole } from '@pm/shared/constants'
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
import { AlertCircle, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { AccessPicker, type PickerProject, type PickerWorkspace } from './access-picker'
import { inviteMember } from './actions'
import { InviteLinkNotice } from './invite-link-notice'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      Send invite
    </Button>
  )
}

/**
 * Invite dialog.
 *
 * The role list is narrowed to what the inviter may actually grant, so the form
 * cannot offer a choice the server will reject.
 *
 * Access is part of the invitation rather than a follow-up step. An invite that
 * grants an organization membership and nothing else produces a member who signs
 * in to an empty app and has to be chased twice — so the projects they should be
 * working on are chosen here, and the email that goes out names them.
 */
export function InviteDialog({
  orgSlug,
  actorRole,
  workspaces,
  projects,
  trigger = 'default',
}: {
  orgSlug: string
  actorRole: OrgRole
  workspaces: PickerWorkspace[]
  projects: PickerProject[]
  /** `compact` is the topbar's icon button; `default` is the page header's. */
  trigger?: 'default' | 'compact'
}) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<OrgRole>('member')
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(new Set())
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set())
  const [state, formAction] = useFormState(inviteMember.bind(null, orgSlug), null)
  const [fallbackLink, setFallbackLink] = useState<{ email: string; url: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (!state?.ok) return

    setOpen(false)
    setSelectedWorkspaces(new Set())
    setSelectedProjects(new Set())

    if (state.data.emailed) {
      const where =
        state.data.projectNames.length > 0
          ? `${state.data.email} · ${state.data.projectNames.join(', ')}`
          : state.data.email
      toast({ title: 'Invite sent', description: where })
    } else {
      // Say what actually happened. The membership is created either way, so
      // reporting "invite sent" would leave someone waiting for an email that
      // is not coming.
      toast({
        variant: 'destructive',
        title: 'Added, but not emailed',
        description: state.data.emailError ?? 'Email could not be delivered.',
      })
      if (state.data.acceptUrl) {
        setFallbackLink({ email: state.data.email, url: state.data.acceptUrl })
      }
    }

    router.refresh()
  }, [state, router])

  const grantable = ASSIGNABLE_ORG_ROLES.filter((candidate) =>
    // An inviter can never create a peer or a senior.
    actorRole === 'owner' ? true : actorRole === 'admin' ? candidate !== 'admin' : false,
  )

  if (grantable.length === 0) return null

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  function toggle(set: Set<string>, id: string) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  return (
    <>
      {trigger === 'compact' ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          Invite
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          Invite member
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a member</DialogTitle>
            <DialogDescription>
              They receive an email with a link to set a password and join this organization.
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
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                autoFocus
                placeholder="colleague@company.com"
              />
              {fieldError('email') ? (
                <p className="text-nav text-destructive">{fieldError('email')}</p>
              ) : null}
            </div>

            <fieldset className="space-y-2">
              <legend className="pb-1 text-ui font-medium">Role</legend>
              {grantable.map((candidate) => (
                <label
                  key={candidate}
                  className="border-border-subtle hover:border-border has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5 flex cursor-pointer gap-3 rounded-md border p-3 transition-colors"
                >
                  <input
                    type="radio"
                    name="role"
                    value={candidate}
                    checked={role === candidate}
                    onChange={() => setRole(candidate)}
                    className="mt-0.5 accent-[hsl(var(--primary))]"
                  />
                  <span className="min-w-0">
                    <span className="block text-base font-medium">
                      {ORG_ROLE_LABELS[candidate]}
                    </span>
                    <span className="text-muted-foreground block pt-0.5 text-nav leading-relaxed">
                      {ORG_ROLE_DESCRIPTIONS[candidate]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="pb-1 text-ui font-medium">Access</legend>
              <AccessPicker
                workspaces={workspaces}
                projects={projects}
                selectedWorkspaces={selectedWorkspaces}
                selectedProjects={selectedProjects}
                onToggleWorkspace={(id) => setSelectedWorkspaces((set) => toggle(set, id))}
                onToggleProject={(id) => setSelectedProjects((set) => toggle(set, id))}
              />
              <p className="text-nav text-faint">
                Ticking a project adds its workspace too. Without at least one project they can
                sign in but will not see any work.
              </p>
            </fieldset>

            {/*
              The selections are hidden inputs rather than component state read
              at submit time, so the form is a plain form: it posts the same
              payload whether it is submitted by the button, by Enter, or by a
              browser restoring it.
            */}
            {[...selectedWorkspaces].map((id) => (
              <input key={id} type="hidden" name="workspace_ids" value={id} />
            ))}
            {[...selectedProjects].map((id) => (
              <input key={id} type="hidden" name="project_ids" value={id} />
            ))}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <InviteLinkNotice
        invite={fallbackLink}
        onClose={() => setFallbackLink(null)}
      />
    </>
  )
}
