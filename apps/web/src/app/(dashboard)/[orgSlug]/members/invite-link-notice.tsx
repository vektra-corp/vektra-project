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
import { useState } from 'react'

/**
 * The escape hatch for an invitation that could not be emailed.
 *
 * Without this the flow dead-ends: the person has a membership row, no password,
 * and no way to reach the one link that would let them set one. Showing the link
 * lets the inviter pass it on over any channel they already trust.
 *
 * Deliberately modal and deliberately transient — it is a single-use credential,
 * so it is shown once, on demand, and never persisted to the members list.
 */
export function InviteLinkNotice({
  invite,
  onClose,
}: {
  invite: { email: string; url: string } | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite!.url)
      setCopied(true)
      toast({ title: 'Link copied' })
    } catch {
      // Clipboard access can be refused (insecure origin, permission). The link
      // is on screen and selectable, so this is a downgrade, not a failure.
      toast({ variant: 'destructive', title: 'Could not copy — select the link instead' })
    }
  }

  return (
    <Dialog open={Boolean(invite)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send this link to {invite?.email}</DialogTitle>
          <DialogDescription>
            They now have access, but the invitation email could not be delivered. This link lets
            them set a password and sign in. It expires in 24 hours and works once.
          </DialogDescription>
        </DialogHeader>

        <code className="bg-chip text-muted-foreground block max-h-32 overflow-y-auto break-all rounded-md p-3 text-nav">
          {invite?.url}
        </code>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
