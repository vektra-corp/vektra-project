import { Button } from '@pm/ui'
import { ShieldX } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Access denied' }

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <ShieldX className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="text-head font-semibold">Access denied</h1>
      {/*
        Two different refusals land here — "you are not in this organization"
        and "your role does not reach this screen" — and the page cannot tell
        them apart, because `forbidden()` carries no reason and giving it one
        would mean telling an outsider which organizations exist.

        So the copy covers both without asserting either. The previous wording
        claimed the reader was not a member, which is simply untrue for the
        common case: a member opening a manager-only report is a colleague who
        took a wrong turn, and telling them they have been removed from the
        organization is alarming and wrong.
      */}
      <p className="max-w-sm text-ui text-muted-foreground">
        This page needs a role your account does not have — or you are not a member of this
        organization. If you think that is wrong, ask an admin to check your access.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Go to your workspace</Link>
      </Button>
    </main>
  )
}
