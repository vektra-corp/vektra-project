'use client'

import { ASSIGNABLE_ORG_ROLES, ORG_ROLE_LABELS } from '@pm/auth/constants'
import { canManageRole, hasPermission, isAtLeast } from '@pm/auth/rbac'
import type { OrgRole } from '@pm/shared/constants'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@pm/ui'
import { MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { PickerProject, PickerWorkspace } from './access-picker'
import { removeMember, resendInvite, updateMemberRole } from './actions'
import { InviteLinkNotice } from './invite-link-notice'
import { MemberAccessDialog } from './member-access-dialog'

/**
 * Per-member menu.
 *
 * Every entry is gated by `canManageRole`, the same predicate the server action
 * applies, so the menu shows exactly what will succeed. It renders nothing at
 * all when the viewer can do nothing to this member.
 */
export function MemberRowActions({
  orgSlug,
  actorRole,
  member,
  isSelf,
  workspaces,
  projects,
}: {
  orgSlug: string
  actorRole: OrgRole
  member: {
    userId: string
    fullName: string
    email: string | null
    role: OrgRole
    status: 'pending' | 'active'
    workspaceIds: string[]
    projectIds: string[]
  }
  isSelf: boolean
  workspaces: PickerWorkspace[]
  projects: PickerProject[]
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [fallbackLink, setFallbackLink] = useState<{ email: string; url: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const assignable = ASSIGNABLE_ORG_ROLES.filter((role) =>
    canManageRole(actorRole, member.role, role),
  )
  const canRemove = !isSelf && canManageRole(actorRole, member.role, 'member')
  // Access is editable for anyone but the owner: it is not a rank change, so it
  // is not gated by `canManageRole` — a manager may put a peer on a project.
  const canEditAccess = member.role !== 'owner' && hasPermission(actorRole, 'users', 'update')
  const canResend = member.status === 'pending' && hasPermission(actorRole, 'users', 'create')

  if (assignable.length === 0 && !canRemove && !canEditAccess && !canResend) return null

  function changeRole(next: string) {
    startTransition(async () => {
      const result = await updateMemberRole(orgSlug, member.userId, next as OrgRole)
      if (result.ok) {
        toast({ title: `${member.fullName} is now ${ORG_ROLE_LABELS[next as OrgRole]}` })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not change role', description: result.message })
      }
    })
  }

  function resend() {
    startTransition(async () => {
      const result = await resendInvite(orgSlug, member.userId)
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not resend', description: result.message })
        return
      }
      if (result.data.emailed) {
        toast({ title: `Invitation resent to ${member.fullName}` })
        return
      }
      toast({
        variant: 'destructive',
        title: 'Not emailed',
        description: result.data.emailError ?? 'Email could not be delivered.',
      })
      if (result.data.acceptUrl && member.email) {
        setFallbackLink({ email: member.email, url: result.data.acceptUrl })
      }
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await removeMember(orgSlug, member.userId)
      if (result.ok) {
        setConfirmOpen(false)
        toast({ title: `Removed ${member.fullName}` })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not remove', description: result.message })
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={`Manage ${member.fullName}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-52">
          {canEditAccess ? (
            <DropdownMenuItem onSelect={() => setAccessOpen(true)}>
              Workspace & project access
            </DropdownMenuItem>
          ) : null}

          {canResend ? (
            <DropdownMenuItem onSelect={resend}>Resend invitation</DropdownMenuItem>
          ) : null}

          {(canEditAccess || canResend) && assignable.length > 0 ? (
            <DropdownMenuSeparator />
          ) : null}

          {assignable.length > 0 ? (
            <>
              <DropdownMenuLabel>Role</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={member.role} onValueChange={changeRole}>
                {assignable.map((role) => (
                  <DropdownMenuRadioItem key={role} value={role}>
                    {ORG_ROLE_LABELS[role]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : null}

          {canRemove ? (
            <>
              {assignable.length > 0 || canEditAccess || canResend ? (
                <DropdownMenuSeparator />
              ) : null}
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                Remove from organization
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <MemberAccessDialog
        orgSlug={orgSlug}
        open={accessOpen}
        onOpenChange={setAccessOpen}
        member={member}
        workspaces={workspaces}
        projects={projects}
        workspacesReadOnly={!isAtLeast(actorRole, 'admin')}
      />

      <InviteLinkNotice invite={fallbackLink} onClose={() => setFallbackLink(null)} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {member.fullName}?</DialogTitle>
            <DialogDescription>
              They lose access immediately. Work they created stays, and tasks assigned to them
              become unassigned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={pending} onClick={remove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
