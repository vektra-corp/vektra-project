'use client'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { AccessPicker, type PickerProject, type PickerWorkspace } from './access-picker'
import { updateMemberAccess } from './actions'

/**
 * Change an existing member's workspace and project access.
 *
 * The dialog submits the complete intended set rather than a list of changes,
 * which is what lets it be safely re-opened and re-saved: whatever is ticked
 * when you press Save is exactly what the member ends up with.
 *
 * Selections reset from props each time it opens, so a cancelled edit does not
 * linger and a stale tab cannot save yesterday's picture.
 */
export function MemberAccessDialog({
  orgSlug,
  open,
  onOpenChange,
  member,
  workspaces,
  projects,
  workspacesReadOnly = false,
}: {
  orgSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  member: {
    userId: string
    fullName: string
    workspaceIds: string[]
    projectIds: string[]
  }
  workspaces: PickerWorkspace[]
  projects: PickerProject[]
  workspacesReadOnly?: boolean
}) {
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(new Set())
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    setSelectedWorkspaces(new Set(member.workspaceIds))
    setSelectedProjects(new Set(member.projectIds))
  }, [open, member.workspaceIds, member.projectIds])

  function toggle(set: Set<string>, id: string) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  function save() {
    startTransition(async () => {
      const result = await updateMemberAccess(orgSlug, {
        userId: member.userId,
        workspaceIds: [...selectedWorkspaces],
        projectIds: [...selectedProjects],
      })

      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not save access', description: result.message })
        return
      }

      onOpenChange(false)
      toast({
        title: `Access updated for ${member.fullName}`,
        description:
          result.data.addedProjects.length > 0
            ? `Notified about ${result.data.addedProjects.join(', ')}.`
            : undefined,
      })
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{member.fullName}’s access</DialogTitle>
          <DialogDescription>
            Choose the workspaces and projects they can open. They are emailed about projects that
            are new to them, and nothing is sent for access they already had.
          </DialogDescription>
        </DialogHeader>

        <AccessPicker
          workspaces={workspaces}
          projects={projects}
          selectedWorkspaces={selectedWorkspaces}
          selectedProjects={selectedProjects}
          onToggleWorkspace={(id) => setSelectedWorkspaces((set) => toggle(set, id))}
          onToggleProject={(id) => setSelectedProjects((set) => toggle(set, id))}
          workspacesReadOnly={workspacesReadOnly}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
