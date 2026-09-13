'use client'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  toast,
} from '@pm/ui'
import { Ban, Eye, MoreHorizontal, PauseCircle, PlayCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { setOrgStatus } from '../actions'

type Blocking = 'suspended' | 'banned'

/**
 * Row actions for a tenant.
 *
 * Right-click opens the menu, as asked for. It is NOT the only way in: a
 * right-click cannot be reached from a keyboard and is invisible to anyone who
 * has never been told it is there, so the same menu hangs off a focusable
 * button on every row. The context menu is the shortcut; the button is the
 * interface.
 *
 * Suspending and banning both lock every user of the tenant out of the product,
 * so both go through a confirmation that requires a reason — the tenant is
 * shown that text on the blocked screen.
 */
export function OrgRowMenu({
  orgId,
  orgName,
  status,
  readOnly,
}: {
  orgId: string
  orgName: string
  status: string
  readOnly: boolean
}) {
  const router = useRouter()
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [confirming, setConfirming] = useState<Blocking | null>(null)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setAt(null), [])

  useEffect(() => {
    if (!at) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close, true)
    }
  }, [at, close])

  function apply(next: string, why: string) {
    const form = new FormData()
    form.set('org_id', orgId)
    form.set('status', next)
    form.set('reason', why)
    startTransition(async () => {
      const result = await setOrgStatus(form)
      if (result.ok) {
        toast({ title: `${orgName} is now ${next}.` })
        setConfirming(null)
        setReason('')
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Failed', description: result.message })
      }
    })
  }

  const blocked = status === 'suspended' || status === 'banned'

  const items = [
    {
      key: 'view',
      label: 'View detail',
      icon: Eye,
      run: () => router.push(`/orgs/${orgId}`),
      disabled: false,
      danger: false,
    },
    {
      key: 'suspend',
      label: 'Suspend',
      icon: PauseCircle,
      run: () => setConfirming('suspended'),
      disabled: readOnly || status === 'suspended',
      danger: true,
    },
    {
      key: 'ban',
      label: 'Ban',
      icon: Ban,
      run: () => setConfirming('banned'),
      disabled: readOnly || status === 'banned',
      danger: true,
    },
    {
      key: 'reactivate',
      label: 'Reactivate',
      icon: PlayCircle,
      run: () => apply('active', ''),
      disabled: readOnly || !blocked,
      danger: false,
    },
  ]

  const menu = at ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${orgName}`}
      className="border-border bg-surface-overlay fixed z-50 w-44 rounded-md border py-1 shadow-card"
      style={{ left: at.x, top: at.y }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled || pending}
          onClick={() => {
            close()
            item.run()
          }}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            item.danger ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-surface-hover'
          }`}
        >
          <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {item.label}
        </button>
      ))}
    </div>
  ) : null

  return (
    <>
      {/*
        The right-click surface covers the whole row via a parent handler, and
        this button is the same menu for anyone not using a mouse.
      */}
      <span
        onContextMenu={(e) => {
          e.preventDefault()
          // Clamp so a row near the viewport edge does not open the menu offscreen.
          setAt({
            x: Math.min(e.clientX, window.innerWidth - 190),
            y: Math.min(e.clientY, window.innerHeight - 160),
          })
        }}
        data-org-context
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${orgName}`}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setAt({ x: Math.min(r.left - 150, window.innerWidth - 190), y: r.bottom + 4 })
          }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </span>

      {menu}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === 'banned' ? 'Ban' : 'Suspend'} {orgName}?
            </DialogTitle>
            <DialogDescription>
              Every user in this organization is locked out of the product immediately.
              {confirming === 'banned'
                ? ' A ban records a decision made for cause.'
                : ' A suspension is the reversible one — normally a billing problem.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="ban-reason" className="label-meta text-faint block">
              Reason — shown to the tenant
            </label>
            <Textarea
              id="ban-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Payment failed after three retries. Contact billing@vektracorp.in."
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={pending}
              disabled={!reason.trim()}
              onClick={() => confirming && apply(confirming, reason.trim())}
            >
              {confirming === 'banned' ? 'Ban' : 'Suspend'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
