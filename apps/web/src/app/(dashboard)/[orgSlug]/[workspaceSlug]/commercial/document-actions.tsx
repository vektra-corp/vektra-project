'use client'

import { COMMERCIAL_STATUSES, type CommercialDocType } from '@pm/shared/constants'
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
import { ChevronDown, MoreHorizontal, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { deleteCommercialDoc, setCommercialStatus } from './actions'

interface Scope {
  orgSlug: string
  workspaceSlug: string
}

/** Status and delete — everything that acts on a quotation. */
export function DocumentActions({
  scope,
  documentId,
  docType,
  docSegment,
  status,
  canDelete,
}: {
  scope: Scope
  documentId: string
  docType: CommercialDocType
  docSegment: string
  status: string
  canDelete: boolean
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const isDraft = status === 'draft'

  function changeStatus(next: string) {
    startTransition(async () => {
      const result = await setCommercialStatus(scope, documentId, next)
      if (result.ok) {
        toast({ title: `Marked ${next.replace('_', ' ')}` })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not update', description: result.message })
      }
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteCommercialDoc(scope, documentId)
      if (result.ok) {
        toast({ title: 'Draft deleted' })
        router.push(`/${scope.orgSlug}/${scope.workspaceSlug}/commercial/${docSegment}`)
      } else {
        toast({ variant: 'destructive', title: 'Could not delete', description: result.message })
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="subtle" size="sm" className="gap-1.5" disabled={pending}>
            Status
            <ChevronDown className="h-3 w-3 text-faint" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={status} onValueChange={changeStatus}>
            {(COMMERCIAL_STATUSES[docType] as readonly string[]).map((option) => (
              <DropdownMenuRadioItem key={option} value={option} className="capitalize">
                {option.replace('_', ' ')}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {canDelete && isDraft ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 aria-hidden />
              Delete draft
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              Its number is not reused, so the sequence will show a gap. Only a draft can
              be deleted — a quotation that has been sent is marked rejected or expired
              instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={pending} onClick={remove}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
