'use client'

import { Alert, AlertDescription, Button, Input, toast } from '@pm/ui'
import { AlertCircle, Pause, Play } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { useFormState } from 'react-dom'
import { SelectField } from '@/components/settings/settings-form'
import { startTimer, stopTimer } from './actions'

export interface RunningEntry {
  id: string
  startedAt: string
  description: string | null
  projectName: string
}

/** `1h 04m 09s`, zero-padded so the width does not jitter as it counts. */
function elapsed(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${pad(m)}m ${pad(s)}s`
}

/**
 * The running timer.
 *
 * Elapsed time is computed from `start_time` on every tick rather than counted
 * up in state, so it stays correct across a sleeping laptop, a backgrounded tab
 * or a page that has been open for hours.
 */
export function Timer({
  orgSlug,
  running,
  projects,
}: {
  orgSlug: string
  running: RunningEntry | null
  projects: { id: string; name: string }[]
}) {
  const [now, setNow] = useState(() => Date.now())
  const [pending, startTransition] = useTransition()
  const [state, formAction] = useFormState(startTimer.bind(null, orgSlug), null)
  const router = useRouter()

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])

  function stop() {
    if (!running) return
    startTransition(async () => {
      const result = await stopTimer(orgSlug, running.id)
      if (result.ok) {
        toast({ title: 'Timer stopped' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not stop', description: result.message })
      }
    })
  }

  if (running) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-status-progress/40 bg-status-progress/5 px-4 py-3">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-progress opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-status-progress" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">
            {running.description || 'Untitled work'}
          </p>
          <p className="label-meta pt-1 text-faint">{running.projectName}</p>
        </div>

        <span className="font-mono text-lg tabular-nums">{elapsed(running.startedAt, now)}</span>

        <Button variant="subtle" size="sm" loading={pending} onClick={stop}>
          <Pause className="h-3.5 w-3.5" aria-hidden />
          Stop
        </Button>
      </div>
    )
  }

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-card"
    >
      {state && !state.ok ? (
        <Alert variant="destructive" className="w-full">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="min-w-0 flex-1 space-y-1.5">
        <label htmlFor="timer-description" className="label-meta text-faint">
          What are you working on?
        </label>
        <Input
          id="timer-description"
          name="description"
          placeholder="Describe the work"
          maxLength={500}
        />
      </div>

      <div className="w-56 space-y-1.5">
        <label htmlFor="timer-project" className="label-meta text-faint">
          Project
        </label>
        <SelectField
          id="timer-project"
          name="project_id"
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
        />
      </div>

      <Button type="submit" disabled={projects.length === 0}>
        <Play className="h-3.5 w-3.5" aria-hidden />
        Start
      </Button>
    </form>
  )
}

export { elapsed }
