'use client'

import { ASSIGNABLE_ORG_ROLES, ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS } from '@pm/auth/constants'
import type { OrgRole } from '@pm/shared/constants'
import {
  Alert,
  AlertDescription,
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
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { inviteMember } from './actions'

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
 */
export function InviteDialog({
  orgSlug,
  actorRole,
  workspaces,
}: {
  orgSlug: string
  actorRole: OrgRole
  workspaces: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<OrgRole>('member')
  const [state, formAction] = useFormState(inviteMember.bind(null, orgSlug), null)
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      // Say what actually happened. The membership is created either way, so
      // reporting "invite sent" when no mail went out would leave someone
      // waiting for an email that is not coming.
      toast(
        state.data.emailed
          ? { title: 'Invite sent', description: state.data.email }
          : {
              variant: 'destructive',
              title: 'Added, but not emailed',
              description: `${state.data.email} now has access. Send them the link yourself — email delivery is not configured or the address was rejected.`,
            },
      )
      router.refresh()
    }
  }, [state, router])

  const grantable = ASSIGNABLE_ORG_ROLES.filter((candidate) =>
    // An inviter can never create a peer or a senior.
    actorRole === 'owner' ? true : actorRole === 'admin' ? candidate !== 'admin' : false,
  )

  if (grantable.length === 0) return null

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-3.5 w-3.5" aria-hidden />
        Invite member
      </Button>

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
                  className="flex cursor-pointer gap-3 rounded-md border border-border-subtle p-3 transition-colors hover:border-border has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5"
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
                    <span className="block pt-0.5 text-nav leading-relaxed text-muted-foreground">
                      {ORG_ROLE_DESCRIPTIONS[candidate]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {workspaces.length > 0 ? (
              <fieldset className="space-y-2">
                <legend className="pb-1 text-ui font-medium">Add to workspaces</legend>
                <div className="space-y-1.5">
                  {workspaces.map((workspace) => (
                    <label
                      key={workspace.id}
                      className="flex cursor-pointer items-center gap-2.5 text-base"
                    >
                      <Checkbox name="workspace_ids" value={workspace.id} size="sm" />
                      {workspace.name}
                    </label>
                  ))}
                </div>
                <p className="text-nav text-faint">
                  Without a workspace they can sign in but will not see any projects.
                </p>
              </fieldset>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
