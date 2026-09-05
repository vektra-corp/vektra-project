'use client'

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
} from '@pm/ui'
import { AlertCircle, FilePlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import type { KanbanScope } from '@/components/kanban/types'
import { createDocument } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      Create document
    </Button>
  )
}

/** Title-only creation; the body is written in the editor that opens next. */
export function NewDocumentDialog({ scope }: { scope: KanbanScope }) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useFormState(createDocument.bind(null, scope), null)
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      router.push(
        `/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/documents/${state.data.id}`,
      )
    }
  }, [state, router, scope])

  const fieldError = state && !state.ok ? state.fieldErrors?.title?.[0] : undefined

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <FilePlus className="h-3.5 w-3.5" aria-hidden />
        New document
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New document</DialogTitle>
            <DialogDescription>
              Starts as a draft. Only published documents are visible to portal users.
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
              <Label htmlFor="doc-title">Title</Label>
              <Input
                id="doc-title"
                name="title"
                required
                autoFocus
                maxLength={200}
                placeholder="Architecture decision record"
              />
              {fieldError ? <p className="text-nav text-destructive">{fieldError}</p> : null}
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
    </>
  )
}
