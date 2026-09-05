'use client'

import { Badge, Button, toast } from '@pm/ui'
import { LogOut, Monitor } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { revokeOtherSessions, revokeSession } from './actions'

export interface SessionRow {
  id: string
  device: string | null
  ipAddress: string | null
  lastActive: string
  createdAt: string
  /** True for the session making this request. */
  isCurrent: boolean
}

export function SessionList({
  orgSlug,
  sessions,
  formatWhen,
}: {
  orgSlug: string
  sessions: SessionRow[]
  /** Pre-formatted on the server so the list respects the org's locale. */
  formatWhen: Record<string, string>
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const others = sessions.filter((session) => !session.isCurrent)

  const run = (work: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    startTransition(async () => {
      const result = await work()
      if (result.ok) {
        toast({ title: success })
        router.refresh()
      } else {
        toast({ title: result.message ?? 'That did not work', variant: 'destructive' })
      }
    })
  }

  return (
    <section className="rounded-lg border border-border bg-surface shadow-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Where you are signed in</h2>
          <p className="pt-1 text-[13px] text-muted-foreground">
            Revoking stops a device from renewing its access. It loses access within an
            hour and cannot sign back in without your password.
          </p>
        </div>
        {others.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => revokeOtherSessions(orgSlug),
                `Signed out ${others.length} other session${others.length === 1 ? '' : 's'}`,
              )
            }
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Sign out everywhere else
          </Button>
        ) : null}
      </header>

      {sessions.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
          No sessions recorded yet. They appear here after your next sign-in.
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Monitor className="h-4 w-4 shrink-0 text-faint" aria-hidden />

              <div className="min-w-0 flex-1">
                <p className="text-[13px]">
                  {session.device ?? 'Unknown device'}
                  {session.isCurrent ? (
                    <Badge variant="success" shape="meta" className="ms-2">
                      This device
                    </Badge>
                  ) : null}
                </p>
                <p className="pt-0.5 text-xs text-faint">
                  {session.ipAddress ? `${session.ipAddress} · ` : ''}
                  last active {formatWhen[session.id] ?? session.lastActive}
                </p>
              </div>

              {session.isCurrent ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => revokeSession(orgSlug, session.id), 'Session revoked')}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
