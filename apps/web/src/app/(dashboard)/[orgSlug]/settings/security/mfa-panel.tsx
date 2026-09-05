'use client'

import { Alert, AlertDescription, Badge, Button, Input, toast } from '@pm/ui'
import { AlertCircle, ShieldCheck, ShieldOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { confirmTotpEnrolment, removeTotpFactor, startTotpEnrolment } from './actions'

interface Enrolment {
  factorId: string
  qrCode: string
  secret: string
}

/**
 * TOTP enrolment (§13.5).
 *
 * Three states: not enrolled, enrolling (QR shown, code outstanding), enrolled.
 * The middle one is deliberately not persisted anywhere — an abandoned
 * enrolment is cleared the next time enrolment starts, because a half-finished
 * factor that is never verified is not enforced and only causes confusion.
 */
export function MfaPanel({
  orgSlug,
  isEnrolled,
  factorId,
}: {
  orgSlug: string
  isEnrolled: boolean
  factorId: string | null
}) {
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const begin = () => {
    setError(null)
    startTransition(async () => {
      const result = await startTotpEnrolment()
      if (result.ok) setEnrolment(result.data)
      else setError(result.message)
    })
  }

  const confirm = () => {
    if (!enrolment) return
    setError(null)
    startTransition(async () => {
      const result = await confirmTotpEnrolment(orgSlug, enrolment.factorId, code)
      if (result.ok) {
        setEnrolment(null)
        setCode('')
        toast({ title: 'Two-step verification is on' })
        router.refresh()
      } else {
        setError(result.message)
      }
    })
  }

  const remove = () => {
    if (!factorId) return
    startTransition(async () => {
      const result = await removeTotpFactor(orgSlug, factorId)
      if (result.ok) {
        toast({ title: 'Two-step verification is off' })
        router.refresh()
      } else {
        toast({ title: result.message, variant: 'destructive' })
      }
    })
  }

  return (
    <section className="rounded-lg border border-border bg-surface shadow-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            Two-step verification
            <Badge variant={isEnrolled ? 'success' : 'secondary'} shape="meta" className="ms-2">
              {isEnrolled ? 'On' : 'Off'}
            </Badge>
          </h2>
          <p className="pt-1 text-[13px] text-muted-foreground">
            A code from an authenticator app, asked for after your password.
          </p>
        </div>

        {isEnrolled ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={remove}>
            <ShieldOff className="h-3.5 w-3.5" aria-hidden />
            Turn off
          </Button>
        ) : enrolment ? null : (
          <Button type="button" size="sm" disabled={pending} onClick={begin}>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Set up
          </Button>
        )}
      </header>

      <div className="space-y-4 px-5 py-5">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {enrolment ? (
          <>
            <p className="text-[13px] text-muted-foreground">
              Scan this with your authenticator app, then enter the code it shows.
            </p>

            {/*
              The QR is an SVG data URI from Supabase. It is rendered through
              <img>, where browsers do not execute script inside an SVG — this
              is the one place an SVG is safe, and it is not user-supplied.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrolment.qrCode}
              alt="QR code for two-step verification"
              width={180}
              height={180}
              className="rounded-md border border-border-subtle bg-white p-2"
            />

            <div>
              <p className="label-meta pb-1 text-faint">Or enter this key by hand</p>
              <code className="block break-all rounded-md border border-border-subtle bg-surface-raised p-2.5 font-mono text-[11px]">
                {enrolment.secret}
              </code>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40">
                <label htmlFor="totp-code" className="label-meta block pb-1.5 text-faint">
                  Code
                </label>
                <Input
                  id="totp-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className="text-center font-mono tracking-[0.3em]"
                />
              </div>
              <Button type="button" size="sm" loading={pending} onClick={confirm}>
                Confirm
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEnrolment(null)
                  setCode('')
                  setError(null)
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : isEnrolled ? (
          <p className="text-[13px] text-muted-foreground">
            You will be asked for a code each time you sign in. Keep a backup of your
            authenticator — without it and without an admin, you cannot get in.
          </p>
        ) : null}
      </div>
    </section>
  )
}
