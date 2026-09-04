'use client'

import { ASSIGNABLE_ORG_ROLES, ORG_ROLE_LABELS } from '@pm/auth/constants'
import { canManageRole } from '@pm/auth/rbac'
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
import { removeMember, updateMemberRole } from './actions'

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
}: {
  orgSlug: string
  actorRole: OrgRole
  member: { userId: string; fullName: string; role: OrgRole }
  isSelf: boolean
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const assignable = ASSIGNABLE_ORG_ROLES.filter((role) =>
    canManageRole(actorRole, member.role, role),
  )
  const canRemove = !isSelf && canManageRole(actorRole, member.role, 'member')

  if (assignable.length === 0 && !canRemove) return null

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

        <DropdownMenuContent align="end" className="w-44">
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
              {assignable.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                Remove from organization
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

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
