import type { ReactNode } from 'react'

/**
 * The signed-out card.
 *
 * One component rather than the shared `Card` because the auth screens have
 * their own scale: a 14px radius, 32/34 of padding, a 22px rhythm between
 * blocks, and a 25px title. Those metrics apply to sign-in, sign-up, verify,
 * reset and invite alike, and a page that hand-rolled them would drift the
 * first time one of the six was edited.
 */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="border-border bg-card flex flex-col gap-[22px] rounded-[14px] border px-[34px] py-8">
      <div className="flex flex-col gap-[7px]">
        <h1 className="text-[25px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
        {description ? (
          <p className="text-faint text-task leading-normal">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/** The design's "OR" divider between a form and its alternative. */
export function AuthDivider({ label = 'OR' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="bg-border h-px flex-1" />
      <span className="text-subtle font-mono text-meta uppercase tracking-[0.1em]">{label}</span>
      <span aria-hidden className="bg-border h-px flex-1" />
    </div>
  )
}

/**
 * The auth screens' input treatment.
 *
 * Recessed rather than raised — a well in the card, not a panel on it — at the
 * design's 9px radius, 11/13 padding and 14px type. Applied via `className` on
 * the shared `Input` rather than by changing it, because every other form in
 * the app sits on `--card` and wants the smaller default.
 */
export const authInputClass =
  'bg-sunk border-input h-auto rounded-[9px] px-[13px] py-[11px] text-[14px] focus-visible:border-ring focus-visible:ring-0'

/**
 * A labelled auth field.
 *
 * The label is the design's tracked monospace caps — the same face the app uses
 * for every section heading — with an optional control opposite it, which is
 * where "Forgot password?" and the reveal toggle live.
 */
export function AuthField({
  htmlFor,
  label,
  aside,
  error,
  children,
}: {
  htmlFor: string
  label: string
  aside?: ReactNode
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-center">
        <label htmlFor={htmlFor} className="label-meta-lg text-subtle">
          {label}
        </label>
        {aside ? <span className="ms-auto">{aside}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-destructive text-nav">
          {error}
        </p>
      ) : null}
    </div>
  )
}
