'use client'

import { Checkbox, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { updateProjectNotifications } from './actions'

/**
 * The events a person can be told about, in the order they matter to them.
 *
 * Deliberately a short list rather than every value in NOTIFICATION_TYPES: the
 * point is control someone will actually use, and a screen of twenty switches
 * gets abandoned. Anything not listed follows the organization-level setting.
 */
const EVENTS = [
  { type: 'task_assigned', label: 'A task is assigned to me' },
  { type: 'task_priority_changed', label: 'A task’s priority changes' },
  { type: 'task_due_changed', label: 'A due date changes' },
  { type: 'task_due_today', label: 'Something is due today' },
  { type: 'task_due_tomorrow', label: 'Something is due tomorrow' },
  { type: 'task_overdue', label: 'Something goes overdue' },
  { type: 'task_status_changed', label: 'Work I assigned changes status' },
  { type: 'comment_mention', label: 'I am mentioned in a comment' },
] as const

export interface ProjectNotificationState {
  muted: boolean
  preferences: Record<string, { email?: boolean; in_app?: boolean }>
}

/**
 * Per-project, per-person notification control (§19).
 *
 * These are YOUR settings for THIS project — a manager cannot see or change
 * anyone else's, which RLS enforces independently of this screen. Anything left
 * untouched falls through to your organization-wide preferences, so the default
 * state of this panel is "no opinion" rather than "everything off".
 */
export function ProjectNotifications({
  scope,
  projectName,
  initial,
}: {
  scope: { orgSlug: string; workspaceSlug: string; projectId: string }
  projectName: string
  initial: ProjectNotificationState
}) {
  const [state, setState] = useState(initial)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function persist(next: ProjectNotificationState, description: string) {
    const previous = state
    setState(next)

    startTransition(async () => {
      const result = await updateProjectNotifications(scope, {
        muted: next.muted,
        preferences: next.preferences,
      })
      if (!result.ok) {
        setState(previous)
        toast({ variant: 'destructive', title: 'Could not save', description: result.message })
        return
      }
      toast({ title: description })
      router.refresh()
    })
  }

  function setChannel(type: string, channel: 'email' | 'in_app', enabled: boolean) {
    const current = state.preferences[type] ?? {}
    persist(
      {
        ...state,
        preferences: { ...state.preferences, [type]: { ...current, [channel]: enabled } },
      },
      'Notification settings saved',
    )
  }

  // An unset channel shows as on: that is what it will actually do, because an
  // absent value falls through to the org default, which is on for email and
  // in-app. Showing it unchecked would misrepresent what happens.
  const channelOn = (type: string, channel: 'email' | 'in_app') =>
    state.preferences[type]?.[channel] ?? true

  return (
    <section className="border-border bg-surface shadow-card rounded-lg border">
      <div className="border-border-subtle border-b px-5 py-4">
        <h2 className="text-ui font-semibold">My notifications</h2>
        <p className="text-muted-foreground pt-1 text-base">
          Yours alone, and only for {projectName}. Nobody else can see or change these. Anything
          left alone follows your organization settings.
        </p>
      </div>

      <label className="border-border-subtle flex cursor-pointer items-start justify-between gap-6 border-b px-5 py-4">
        <span className="min-w-0">
          <span className="block text-base font-medium">Mute this project</span>
          <span className="text-muted-foreground block pt-0.5 text-nav leading-relaxed">
            Stops every notification from this project, including email. Other projects are
            unaffected.
          </span>
        </span>
        <Checkbox
          className="mt-0.5 shrink-0"
          checked={state.muted}
          disabled={pending}
          onChange={(event) =>
            persist(
              { ...state, muted: event.target.checked },
              event.target.checked ? `Muted ${projectName}` : `Unmuted ${projectName}`,
            )
          }
          aria-label="Mute this project"
        />
      </label>

      <div className={state.muted ? 'pointer-events-none opacity-50' : undefined}>
        <div className="border-border-subtle label-meta-lg text-subtle grid grid-cols-[1fr_64px_64px] gap-3 border-b px-5 py-2.5">
          <span>Event</span>
          <span className="text-center">In app</span>
          <span className="text-center">Email</span>
        </div>

        {EVENTS.map((event) => (
          <div
            key={event.type}
            className="border-border-subtle grid grid-cols-[1fr_64px_64px] items-center gap-3 border-b px-5 py-2.5 last:border-b-0"
          >
            <span className="text-base">{event.label}</span>
            <span className="flex justify-center">
              <Checkbox
                size="sm"
                checked={channelOn(event.type, 'in_app')}
                disabled={pending || state.muted}
                onChange={(e) => setChannel(event.type, 'in_app', e.target.checked)}
                aria-label={`${event.label} — in app`}
              />
            </span>
            <span className="flex justify-center">
              <Checkbox
                size="sm"
                checked={channelOn(event.type, 'email')}
                disabled={pending || state.muted}
                onChange={(e) => setChannel(event.type, 'email', e.target.checked)}
                aria-label={`${event.label} — email`}
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
