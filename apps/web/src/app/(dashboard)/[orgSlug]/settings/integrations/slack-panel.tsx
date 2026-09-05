'use client'

import { INTEGRATION_SUBSCRIBABLE_EVENTS, type SlackConfig } from '@pm/shared/constants'
import { Alert, AlertDescription, Badge, Button, Checkbox, toast } from '@pm/ui'
import { AlertCircle, Link2, RefreshCw, Unplug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { disconnectSlack, listSlackChannels, saveSlackConfig } from './actions'

interface Channel {
  id: string
  name: string
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" loading={pending}>
      Save
    </Button>
  )
}

/** Group the event list by resource so it reads as sections, not a wall. */
function groupEvents(): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const event of INTEGRATION_SUBSCRIBABLE_EVENTS) {
    const resource = event.split('.')[0] ?? 'other'
    groups.set(resource, [...(groups.get(resource) ?? []), event])
  }
  return [...groups.entries()]
}

export function SlackPanel({
  orgSlug,
  connected,
  config,
  status,
  lastError,
  configured,
}: {
  orgSlug: string
  connected: boolean
  config: SlackConfig
  status: string | null
  lastError: string | null
  /** Whether this deployment has Slack credentials at all. */
  configured: boolean
}) {
  const [state, formAction] = useFormState(saveSlackConfig.bind(null, orgSlug), null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [loadingChannels, startLoading] = useTransition()
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      toast({ title: 'Slack settings saved' })
      router.refresh()
    }
  }, [state, router])

  const loadChannels = () => {
    startLoading(async () => {
      const result = await listSlackChannels(orgSlug)
      if (result.ok) setChannels(result.data)
      else toast({ title: result.message, variant: 'destructive' })
    })
  }

  if (!configured) {
    return (
      <Alert>
        <AlertCircle aria-hidden />
        <AlertDescription>
          Slack is not configured on this deployment. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET
          and INTEGRATION_ENCRYPTION_KEY to enable it.
        </AlertDescription>
      </Alert>
    )
  }

  if (!connected) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-5 py-4 shadow-card">
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium">Slack</p>
          <p className="pt-1 text-base text-muted-foreground">
            Post activity to a channel. We ask only for permission to post — never to read
            your messages.
          </p>
        </div>
        <Button asChild size="sm">
          <a href={`/api/integrations/slack/authorize?org=${encodeURIComponent(orgSlug)}`}>
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            Connect Slack
          </a>
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium">
            Slack
            {config.teamName ? (
              <span className="ps-2 text-base font-normal text-muted-foreground">
                {config.teamName}
              </span>
            ) : null}
          </p>
          <p className="pt-1 text-base text-muted-foreground">
            {config.channelName
              ? `Posting to #${config.channelName}`
              : 'Choose a channel to start posting.'}
          </p>
        </div>

        <Badge variant={status === 'error' ? 'destructive' : 'success'} shape="meta">
          {status === 'error' ? 'Error' : 'Connected'}
        </Badge>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await disconnectSlack(orgSlug)
              if (result.ok) router.refresh()
              else toast({ title: result.message, variant: 'destructive' })
            })
          }
        >
          <Unplug className="h-3.5 w-3.5" aria-hidden />
          Disconnect
        </Button>
      </div>

      <form action={formAction} className="space-y-5 px-5 py-5">
        {lastError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>Last delivery failed: {lastError}</AlertDescription>
          </Alert>
        ) : null}

        {state && !state.ok ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="label-meta text-faint">Channel</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={loadingChannels}
              onClick={loadChannels}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {channels.length > 0 ? 'Refresh' : 'Load channels'}
            </Button>
          </div>

          {channels.length > 0 ? (
            <select
              name="channelId"
              defaultValue={config.channelId ?? ''}
              onChange={(event) => {
                const name = event.target.selectedOptions[0]?.dataset.name ?? ''
                const hidden = event.target.form?.elements.namedItem('channelName')
                if (hidden instanceof HTMLInputElement) hidden.value = name
              }}
              className="h-9 w-full rounded-md border border-border bg-card px-3 text-base"
            >
              <option value="">No channel</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id} data-name={channel.name}>
                  #{channel.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-base text-muted-foreground">
              {config.channelName
                ? `Currently #${config.channelName}. Load channels to change it.`
                : 'Load channels to choose where to post.'}
            </p>
          )}

          {/* Carried alongside the id so the settings page can show the name
              without another Slack call on every render. */}
          <input type="hidden" name="channelName" defaultValue={config.channelName ?? ''} />
        </div>

        <fieldset className="space-y-4">
          <legend className="label-meta pb-1 text-faint">Events to post</legend>
          {groupEvents().map(([resource, events]) => (
            <div key={resource} className="space-y-1.5">
              <p className="text-nav font-medium capitalize text-muted-foreground">
                {resource.replace('_', ' ')}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {events.map((event) => (
                  <label key={event} className="flex items-center gap-2 text-base">
                    <Checkbox
                      name="events"
                      value={event}
                      defaultChecked={config.events.includes(event)}
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">{event}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>

        <div className="border-t border-border-subtle pt-4">
          <SubmitButton />
        </div>
      </form>
    </div>
  )
}
