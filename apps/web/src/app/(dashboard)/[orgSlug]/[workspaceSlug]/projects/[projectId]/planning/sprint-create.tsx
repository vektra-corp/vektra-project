'use client'

import { Button, Input, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createSprint } from './actions'

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

/** A fortnight, the default sprint length, as a yyyy-mm-dd pair starting today. */
function defaultWindow(): { startsOn: string; endsOn: string } {
  const start = new Date()
  const end = new Date(start)
  end.setDate(end.getDate() + 13)
  const iso = (date: Date) => date.toISOString().slice(0, 10)
  return { startsOn: iso(start), endsOn: iso(end) }
}

/**
 * Open a sprint.
 *
 * `createSprint` has existed since sprints were added but nothing ever called
 * it, so Planning told people to "create one to start committing work" with no
 * way to do it. This is that control.
 *
 * Dates default to a fortnight from today because that is the common case and
 * because two empty date fields are a worse prompt than two filled ones; both
 * stay editable. The name is suggested, not imposed, for the same reason.
 */
export function SprintCreate({ scope, suggestedName }: { scope: Scope; suggestedName: string }) {
  const initial = defaultWindow()
  const [name, setName] = useState(suggestedName)
  const [startsOn, setStartsOn] = useState(initial.startsOn)
  const [endsOn, setEndsOn] = useState(initial.endsOn)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return

    startTransition(async () => {
      const result = await createSprint(scope, { name: trimmed, startsOn, endsOn })
      if (!result.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not open the sprint',
          description: result.message,
        })
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-semibold">No open sprint</h2>
        <p className="text-faint pt-1 text-ui">Open one to start committing work to it.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="sprint-name" className="text-nav text-subtle">
          Name
        </label>
        <Input
          id="sprint-name"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sprint-start" className="text-nav text-subtle">
            Starts
          </label>
          <Input
            id="sprint-start"
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sprint-end" className="text-nav text-subtle">
            Ends
          </label>
          <Input
            id="sprint-end"
            type="date"
            value={endsOn}
            min={startsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </div>
      </div>

      {endsOn < startsOn ? (
        <p className="text-destructive text-ui">A sprint cannot end before it starts.</p>
      ) : null}

      <Button
        size="sm"
        loading={pending}
        disabled={!name.trim() || endsOn < startsOn}
        onClick={submit}
        className="w-full"
      >
        Open sprint
      </Button>
    </div>
  )
}
