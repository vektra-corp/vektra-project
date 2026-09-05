'use client'

import { PRIORITIES } from '@pm/shared/constants'
import { Alert, AlertDescription, Button, Input, Label } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createProject } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      Create project
    </Button>
  )
}

export function ProjectForm({
  orgSlug,
  workspaceSlug,
}: {
  orgSlug: string
  workspaceSlug: string
}) {
  const router = useRouter()
  const action = createProject.bind(null, orgSlug, workspaceSlug)
  const [state, formAction] = useFormState(action, null)

  // Navigating from an effect rather than redirect() inside the action keeps the
  // validation errors renderable when the submit fails.
  useEffect(() => {
    if (state?.ok) {
      router.push(`/${orgSlug}/${workspaceSlug}/projects/${state.data.id}/board`)
    }
  }, [state, router, orgSlug, workspaceSlug])

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && state.code === 'INTERNAL_ERROR' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="name">Project name</Label>
        <Input id="name" name="name" required autoFocus maxLength={150} />
        {fieldError('name') ? (
          <p className="text-nav text-destructive">{fieldError('name')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={5000}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-ui shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <select
            id="priority"
            name="priority"
            defaultValue="medium"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-ui shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority} className="capitalize">
                {priority}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="visibility">Visibility</Label>
          <select
            id="visibility"
            name="visibility"
            defaultValue="workspace"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-ui shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="workspace">Workspace members</option>
            <option value="organization">Everyone in the organization</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="start_date">Start date</Label>
          <Input id="start_date" name="start_date" type="date" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end_date">End date</Label>
          <Input id="end_date" name="end_date" type="date" />
          {fieldError('end_date') ? (
            <p className="text-nav text-destructive">{fieldError('end_date')}</p>
          ) : null}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <SubmitButton />
      </div>
    </form>
  )
}
